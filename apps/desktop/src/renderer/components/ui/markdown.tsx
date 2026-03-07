import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkBreaks from 'remark-breaks';
import { APP_BASE_URL } from '../../lib/constants';

interface SourceInfo {
  title: string;
  url: string | null;
  content?: string;
  similarity?: number;
  chunkIndex?: number;
}

interface MarkdownProps {
  content: string;
  className?: string;
  sources?: SourceInfo[];
}

function isInternalPolicyUrl(url: string): boolean {
  return url.startsWith('/api/policies/');
}

function normalizeTitle(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[“”‘’]/g, '')
    .replace(/[_-]+/g, ' ')
    .replace(/[^a-zA-Z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

function getSignificantTokens(value: string): string[] {
  const STOPWORDS = new Set([
    'the',
    'and',
    'for',
    'with',
    'from',
    'that',
    'this',
    'your',
    'into',
    'over',
    'under',
  ]);

  return normalizeTitle(value)
    .split(/\s+/)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

function isEligibleInternalSource(source: SourceInfo): boolean {
  if (!source.url) return true;
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
  return typeof source.chunkIndex === 'number' && Number.isFinite(source.chunkIndex)
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
    const normalizedSource = normalizeTitle(source.title);
    return (
      normalizedSource.includes(normalizedCitation) ||
      normalizedCitation.includes(normalizedSource)
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

function decodeCitationTitleFromHref(href: string): string | undefined {
  if (!href.startsWith('source://')) return undefined;
  const encodedTitle = href.slice('source://'.length);
  if (!encodedTitle) return undefined;

  try {
    return decodeURIComponent(encodedTitle);
  } catch {
    return encodedTitle;
  }
}

function processSourceCitations(content: string, sources?: SourceInfo[]): string {
  if (!sources || sources.length === 0) return content;

  return content.replace(/\[Source:\s*([^\]]+)\](?!\s*\()/gi, (match, titlesBlock) => {
    const titles = titlesBlock
      .split(/,\s*(?=")/g)
      .map((t: string) => t.replace(/^["']|["']$/g, '').trim())
      .filter((t: string) => t.length > 0);

    const links: string[] = [];
    for (const title of titles) {
      const source = findBestSourceMatch(title, sources);
      if (source) {
        links.push(`[📄](source://${encodeURIComponent(source.title)})`);
      }
    }

    return links.length > 0 ? links.join(' ') : match;
  });
}

export function Markdown({ content, className, sources }: MarkdownProps) {
  // Strip thinking tags from content (DeepSeek R1 may include these)
  let processed = content.replace(/<think(?:ing)?>\s*[\s\S]*?<\/think(?:ing)?>/gi, '');
  processed = processed.replace(/\n{4,}/g, '\n\n\n');
  processed = processSourceCitations(processed, sources);

  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm, remarkBreaks]}
      className={`max-w-none ${className || ''}`}
      components={{
        a: ({ href, children, title }) => {
          const isCitationLink = !!href && href.startsWith('source://');
          const decodedCitationTitle = isCitationLink && href
            ? decodeCitationTitleFromHref(href)
            : undefined;
          const matchedCitationSource =
            isCitationLink && decodedCitationTitle && sources
              ? findBestSourceMatch(decodedCitationTitle, sources)
              : undefined;

          if (isCitationLink) {
            if (matchedCitationSource?.url && isInternalPolicyUrl(matchedCitationSource.url)) {
              return (
                <button
                  type="button"
                  onClick={() => window.electron.openExternal(`${APP_BASE_URL}${matchedCitationSource.url}`)}
                  className="text-teal-600 hover:underline cursor-pointer"
                  title={title || 'View source document'}
                >
                  {children}
                </button>
              );
            }

            return (
              <span
                className="text-gray-500"
                title="No direct PDF link available for this source. See source excerpts below."
              >
                {children}
              </span>
            );
          }

          return href && isInternalPolicyUrl(href) ? (
            <button
              type="button"
              onClick={() => window.electron.openExternal(`${APP_BASE_URL}${href}`)}
              className="text-teal-600 hover:underline cursor-pointer"
              title={children?.toString() === '📄' ? 'View source document' : undefined}
            >
              {children}
            </button>
          ) : (
            <span className="text-gray-500">{children}</span>
          );
        },
        // Compact paragraph styling
        p: ({ children }) => (
          <p className="mb-2.5 leading-[1.7] last:mb-0 text-[13.5px] text-slate-700 dark:text-slate-300">
            {children}
          </p>
        ),
        // List styling
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
        // Code styling - check for code block vs inline based on className
        code: ({ className, children, ...props }) => {
          // Inline code typically doesn't have className with language prefix
          const isCodeBlock = className && className.includes('language-');
          if (!isCodeBlock) {
            return (
              <code className="text-teal-600 bg-gray-100 dark:bg-slate-800 px-1 rounded text-xs">
                {children}
              </code>
            );
          }
          return (
            <code className={className} {...props}>
              {children}
            </code>
          );
        },
        // Code block styling
        pre: ({ children }) => (
          <pre className="bg-gray-100 dark:bg-slate-800 rounded-lg p-3 overflow-x-auto my-2 text-xs">
            {children}
          </pre>
        ),
        // Heading styling
        h1: ({ children }) => (
          <h1 className="text-lg font-semibold mt-4 mb-2">{children}</h1>
        ),
        h2: ({ children }) => (
          <h2 className="text-base font-semibold mt-3 mb-2">{children}</h2>
        ),
        h3: ({ children }) => (
          <h3 className="text-sm font-semibold mt-2 mb-1">{children}</h3>
        ),
        // Strong/bold
        strong: ({ children }) => (
          <strong className="font-semibold text-gray-900 dark:text-white">{children}</strong>
        ),
        // Blockquote
        blockquote: ({ children }) => (
          <blockquote className="border-l-4 border-gray-300 dark:border-slate-600 pl-4 italic text-gray-600 dark:text-gray-400 my-2">
            {children}
          </blockquote>
        ),
        // Table styling
        table: ({ children }) => (
          <div className="overflow-x-auto my-2">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700 text-xs">
              {children}
            </table>
          </div>
        ),
        th: ({ children }) => (
          <th className="px-2 py-1 text-left font-semibold bg-gray-50 dark:bg-slate-800">
            {children}
          </th>
        ),
        td: ({ children }) => (
          <td className="px-2 py-1 border-t border-gray-100 dark:border-slate-700">
            {children}
          </td>
        ),
      }}
    >
      {processed}
    </ReactMarkdown>
  );
}
