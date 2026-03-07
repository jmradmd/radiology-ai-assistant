"use client";

import React from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkBreaks from "remark-breaks";
import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";

interface SourceInfo {
  title: string;
  url: string | null;
  pageStart?: number;
  pageEnd?: number;
  chunkIndex?: number;
  content?: string;
  category?: string;
  institution?: string;
  similarity?: number;
  domain?: "protocol" | "knowledge";
  sourceLabel?: string;
}

interface MarkdownProps {
  content: string;
  className?: string;
  stripEmojis?: boolean;
  sources?: SourceInfo[];
  onPdfClick?: (url: string, title: string) => void;
  onCitationClick?: (source: SourceInfo) => void;
}

const CITATION_LINK_PREFIX = "/_citation/";
const LEGACY_CITATION_LINK_PREFIX = "source://";

function isInternalPolicyUrl(url: string): boolean {
  return url.startsWith("/api/policies/");
}

function normalizeTitle(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[“”‘’]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getSignificantTokens(value: string): string[] {
  const STOPWORDS = new Set([
    "the",
    "and",
    "for",
    "with",
    "from",
    "that",
    "this",
    "your",
    "into",
    "over",
    "under",
  ]);

  return normalizeTitle(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function buildCitationHref(citationTitle: string): string {
  return `${CITATION_LINK_PREFIX}${encodeURIComponent(citationTitle)}`;
}

function isCitationHref(href: string): boolean {
  return (
    href.startsWith(CITATION_LINK_PREFIX) ||
    href.startsWith(LEGACY_CITATION_LINK_PREFIX)
  );
}

function decodeCitationTitleFromHref(href: string): string | undefined {
  let encodedTitle = "";
  if (href.startsWith(CITATION_LINK_PREFIX)) {
    encodedTitle = href.slice(CITATION_LINK_PREFIX.length);
  } else if (href.startsWith(LEGACY_CITATION_LINK_PREFIX)) {
    encodedTitle = href.slice(LEGACY_CITATION_LINK_PREFIX.length);
  } else {
    return undefined;
  }

  if (!encodedTitle) return undefined;

  try {
    return decodeURIComponent(encodedTitle);
  } catch {
    // If URI decoding fails, use the raw suffix so citation click still works.
    return encodedTitle;
  }
}

function isEligibleInternalSource(source: SourceInfo): boolean {
  if (!source.url) {
    // Knowledge sources may have null URLs but should still be clickable in-app.
    return true;
  }
  return isInternalPolicyUrl(source.url);
}

function getSourceSimilarityScore(source: SourceInfo): number {
  const similarity = Number(source.similarity);
  return Number.isFinite(similarity) ? similarity : -1;
}

function hasSourceExcerpt(source: SourceInfo): number {
  return source.content && source.content.trim().length > 0 ? 1 : 0;
}

function getSourceChunkIndex(source: SourceInfo): number {
  return typeof source.chunkIndex === "number" && Number.isFinite(source.chunkIndex)
    ? source.chunkIndex
    : Number.MAX_SAFE_INTEGER;
}

function pickBestSource(candidates: SourceInfo[]): SourceInfo | undefined {
  if (candidates.length === 0) return undefined;

  return [...candidates].sort((a, b) => {
    const similarityDiff = getSourceSimilarityScore(b) - getSourceSimilarityScore(a);
    if (similarityDiff !== 0) return similarityDiff;

    const excerptDiff = hasSourceExcerpt(b) - hasSourceExcerpt(a);
    if (excerptDiff !== 0) return excerptDiff;

    const chunkDiff = getSourceChunkIndex(a) - getSourceChunkIndex(b);
    if (chunkDiff !== 0) return chunkDiff;

    return normalizeTitle(a.title).localeCompare(normalizeTitle(b.title));
  })[0];
}

function findBestSourceMatch(citationTitle: string, sources: SourceInfo[]): SourceInfo | undefined {
  const eligibleSources = sources.filter(isEligibleInternalSource);
  const normalizedCitation = normalizeTitle(citationTitle);
  if (!normalizedCitation) return undefined;

  const exactMatches = eligibleSources.filter(
    (source) => normalizeTitle(source.title) === normalizedCitation
  );
  const bestExactMatch = pickBestSource(exactMatches);
  if (bestExactMatch) return bestExactMatch;

  const includesMatches = eligibleSources.filter((source) => {
    const normalizedSourceTitle = normalizeTitle(source.title);
    return (
      normalizedSourceTitle.includes(normalizedCitation) ||
      normalizedCitation.includes(normalizedSourceTitle)
    );
  });
  const bestIncludesMatch = pickBestSource(includesMatches);
  if (bestIncludesMatch) return bestIncludesMatch;

  const citationTokens = getSignificantTokens(citationTitle);
  if (citationTokens.length < 2) return undefined;

  const scored = eligibleSources
    .map((source) => {
      const sourceTokens = new Set(getSignificantTokens(source.title));
      const overlap = citationTokens.filter((token) => sourceTokens.has(token)).length;
      return { source, overlap };
    })
    .filter((entry) => entry.overlap >= 2);

  if (scored.length === 0) return undefined;

  const bestOverlap = Math.max(...scored.map((entry) => entry.overlap));
  const bestOverlapCandidates = scored
    .filter((entry) => entry.overlap === bestOverlap)
    .map((entry) => entry.source);

  return pickBestSource(bestOverlapCandidates);
}

function extractCitationTitles(titlesBlock: string): string[] {
  const quoted = [...titlesBlock.matchAll(/["“”']([^"“”']+)["“”']/g)]
    .map((match) => match[1].trim())
    .filter((title) => title.length > 0);

  if (quoted.length > 0) {
    return quoted;
  }

  return titlesBlock
    .split(",")
    .map((title) => title.replace(/^["'`]+|["'`]+$/g, "").trim())
    .filter((title) => title.length > 0);
}

// Remove DeepSeek R1 thinking tags from output
function removeThinkingTags(text: string): string {
  // Remove <thinking>...</thinking> blocks (including multiline)
  return text
    .replace(/<thinking>[\s\S]*?<\/thinking>/gi, '')
    .replace(/<think>[\s\S]*?<\/think>/gi, '')
    .replace(/\n{4,}/g, "\n\n\n");
}

// Remove emojis from text for cleaner clinical display
function removeEmojis(text: string): string {
  return text
    // Remove common emoji ranges
    .replace(/[\u{1F600}-\u{1F64F}]/gu, '') // Emoticons
    .replace(/[\u{1F300}-\u{1F5FF}]/gu, '') // Misc symbols & pictographs
    .replace(/[\u{1F680}-\u{1F6FF}]/gu, '') // Transport & map symbols
    .replace(/[\u{1F700}-\u{1F77F}]/gu, '') // Alchemical symbols
    .replace(/[\u{1F780}-\u{1F7FF}]/gu, '') // Geometric shapes extended
    .replace(/[\u{1F800}-\u{1F8FF}]/gu, '') // Supplemental arrows-C
    .replace(/[\u{1F900}-\u{1F9FF}]/gu, '') // Supplemental symbols & pictographs
    .replace(/[\u{1FA00}-\u{1FA6F}]/gu, '') // Chess symbols
    .replace(/[\u{1FA70}-\u{1FAFF}]/gu, '') // Symbols & pictographs extended-A
    .replace(/[\u{2600}-\u{26FF}]/gu, '')   // Misc symbols
    .replace(/[\u{2700}-\u{27BF}]/gu, '')   // Dingbats
    .replace(/[\u{FE00}-\u{FE0F}]/gu, '')   // Variation selectors
    .replace(/[\u{1F1E0}-\u{1F1FF}]/gu, ''); // Regional indicator symbols (flags)
}

// Transform [Source: Title] patterns into symbol-only citation links.
function processSourceCitations(content: string): string {
  // Match [Source: ...] blocks (may contain multiple comma-separated titles)
  // Negative lookahead skips already-linked citations: [Source: ...](url)
  return content.replace(/\[Source:\s*([^\]]+)\](?!\s*\()/gi, (match, titlesBlock) => {
    const titles = extractCitationTitles(titlesBlock);
    const targets = titles.length > 0 ? titles : [titlesBlock.trim()];

    if (targets.length === 0 || targets[0].length === 0) {
      return `[📄](${buildCitationHref("Unknown source")})`;
    }

    return targets
      .map((title) => `[📄](${buildCitationHref(title)})`)
      .join(" ");
  });
}

export function Markdown({
  content,
  className,
  stripEmojis = true,
  sources,
  onPdfClick,
  onCitationClick,
}: MarkdownProps) {
  // First remove any thinking tags (DeepSeek R1 chain-of-thought)
  let processedContent = removeThinkingTags(content);
  // Then process other transformations
  processedContent = stripEmojis ? removeEmojis(processedContent) : processedContent;
  processedContent = processSourceCitations(processedContent);
  
  return (
    <div className={cn("max-w-none", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkBreaks]}
        components={{
        h1: ({ children }) => (
          <h1 className="text-[15px] font-bold mt-5 mb-2 first:mt-0 text-slate-900 dark:text-slate-100 tracking-tight">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-[14px] font-semibold mt-4 mb-1.5 text-slate-900 dark:text-slate-100 tracking-tight">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-[13.5px] font-semibold mt-3 mb-1 text-slate-800 dark:text-slate-200">{children}</h3>
        ),
        p: ({ children }) => (
          <p className="mb-2.5 leading-[1.7] last:mb-0 text-[13.5px] text-slate-700 dark:text-slate-300">{children}</p>
        ),
        ul: ({ children }) => (
          <ul className="list-disc pl-5 mb-2.5 space-y-1 text-slate-700 dark:text-slate-300">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="list-decimal pl-5 mb-2.5 space-y-1 text-slate-700 dark:text-slate-300">{children}</ol>
        ),
        li: ({ children }) => (
          <li className="text-[13.5px] leading-[1.65] text-slate-700 dark:text-slate-300 pl-1">
            {children}
          </li>
        ),
        strong: ({ children }) => (
          <strong className="font-semibold text-slate-900 dark:text-slate-100">{children}</strong>
        ),
        em: ({ children }) => <em className="italic text-slate-600 dark:text-slate-400">{children}</em>,
        code: ({ children, className }) => {
          const isInline = !className;
          return isInline ? (
            <code className="bg-slate-100 dark:bg-slate-700/70 text-slate-800 dark:text-slate-200 px-1 py-0.5 rounded-md text-[12.5px] font-mono">
              {children}
            </code>
          ) : (
            <code className="block bg-slate-100 dark:bg-slate-700/70 text-slate-800 dark:text-slate-200 p-3 rounded-lg text-[12.5px] font-mono overflow-x-auto">
              {children}
            </code>
          );
        },
        pre: ({ children }) => (
          <pre className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 p-3 rounded-lg overflow-x-auto my-3">
            {children}
          </pre>
        ),
        a: ({ href, children, title }) => {
          const isCitationLink = !!href && isCitationHref(href);
          const isExternalUrl = href?.startsWith('http://') || href?.startsWith('https://');
          const isInternalPdf = !!href && isInternalPolicyUrl(href);
          const isPdfCitation = children?.toString()?.trim() === '📄' || title?.startsWith('View source:');
          const decodedCitationTitle = isCitationLink && href
            ? decodeCitationTitleFromHref(href)
            : undefined;

          let matchedCitationSource: SourceInfo | undefined;
          if (isCitationLink && sources) {
            matchedCitationSource = findBestSourceMatch(decodedCitationTitle || "", sources);
          }
          
          if (isCitationLink || (isPdfCitation && !!href && isInternalPdf)) {
            const legacyTitle = title?.startsWith("View source: ")
              ? title.replace("View source: ", "")
              : undefined;
            const sourceTitle =
              legacyTitle ||
              matchedCitationSource?.title ||
              decodedCitationTitle ||
              'Document';
            return (
              <button
                onClick={() => {
                  if (isCitationLink) {
                    if (matchedCitationSource && onCitationClick) {
                      onCitationClick(matchedCitationSource);
                      return;
                    }

                    if (onCitationClick) {
                      onCitationClick({
                        title: sourceTitle,
                        url: null,
                        content: "Citation metadata is unavailable or ambiguous for this source.",
                      });
                    }
                    return;
                  }

                  if (matchedCitationSource?.url && isInternalPolicyUrl(matchedCitationSource.url)) {
                    if (onPdfClick) {
                      onPdfClick(matchedCitationSource.url, matchedCitationSource.title);
                    } else {
                      window.location.assign(matchedCitationSource.url);
                    }
                    return;
                  }

                  if (href && isInternalPdf) {
                    if (onPdfClick) {
                      onPdfClick(href, sourceTitle);
                    } else {
                      window.location.assign(href);
                    }
                  }
                }}
                title={sourceTitle}
                aria-label={`Open citation source: ${sourceTitle}`}
                className="inline-flex items-center justify-center w-5 h-5 ml-1 align-middle rounded-md bg-teal-100 dark:bg-teal-900/40 text-teal-600 dark:text-teal-400 hover:bg-teal-200 dark:hover:bg-teal-800/50 transition-colors cursor-pointer"
              >
                <FileText className="w-3 h-3" />
              </button>
            );
          }

          if (isExternalUrl) {
            return (
              <span
                className="text-slate-500 dark:text-slate-400"
                title="External links are disabled"
              >
                {children}
              </span>
            );
          }
          
          return (
            isInternalPdf ? (
              <button
                onClick={() => onPdfClick ? onPdfClick(href, title?.replace('View source: ', '') || 'Document') : window.location.assign(href)}
                className="text-teal-600 dark:text-teal-400 hover:underline"
              >
                {children}
              </button>
            ) : (
              <span className="text-slate-600 dark:text-slate-400">{children}</span>
            )
          );
        },
        blockquote: ({ children }) => (
          <blockquote className="border-l-3 border-teal-400/50 dark:border-teal-500/40 pl-3.5 text-[13px] text-slate-600 dark:text-slate-400 my-3 italic">
            {children}
          </blockquote>
        ),
        table: ({ children }) => (
          <div className="overflow-x-auto my-3 rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-slate-200 dark:divide-slate-700">
              {children}
            </table>
          </div>
        ),
        thead: ({ children }) => (
          <thead className="bg-slate-50 dark:bg-slate-800/80">{children}</thead>
        ),
        th: ({ children }) => (
          <th className="px-3 py-2 text-left text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-3 py-2 text-[13px] border-t border-slate-100 dark:border-slate-700/60 text-slate-700 dark:text-slate-300">{children}</td>
        ),
        hr: () => <hr className="my-4 border-slate-200/80 dark:border-slate-700/60" />,
      }}
    >
      {processedContent}
    </ReactMarkdown>
    </div>
  );
}
