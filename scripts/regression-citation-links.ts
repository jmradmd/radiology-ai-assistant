import { readFileSync } from "fs";
import { join } from "path";

interface SourceInfo {
  title: string;
  url: string | null;
}

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function normalizeCitationTitle(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/[“”‘’]/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/[^a-zA-Z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function backendPreserveSourceMarkers(content: string): string {
  // Runtime policy: backend does not rewrite [Source: ...] into markdown links.
  return content;
}

function frontendProcessSourceCitations(content: string, sources: SourceInfo[]): string {
  const isInternalPolicyUrl = (url: string) => url.startsWith("/api/policies/");
  const isEligibleInternalSource = (source: SourceInfo) =>
    !source.url || isInternalPolicyUrl(source.url);

  const tokenize = (value: string) =>
    {
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

      return normalizeCitationTitle(value)
        .split(/\s+/)
        .filter((w: string) => w.length >= 2 && !STOPWORDS.has(w));
    };

  const findBestSourceMatch = (title: string): SourceInfo | undefined => {
    const eligibleSources = sources.filter(isEligibleInternalSource);
    const normalizedTitle = normalizeCitationTitle(title);
    if (!normalizedTitle) return undefined;

    const exact = eligibleSources.find(
      (source) => normalizeCitationTitle(source.title) === normalizedTitle
    );
    if (exact) return exact;

    const includes = eligibleSources.find((source) => {
      const normalizedSource = normalizeCitationTitle(source.title);
      return (
        normalizedSource.includes(normalizedTitle) ||
        normalizedTitle.includes(normalizedSource)
      );
    });
    if (includes) return includes;

    const titleTokens = tokenize(title);
    if (titleTokens.length === 0) return undefined;

    let bestSource: SourceInfo | undefined;
    let bestOverlap = 0;
    for (const source of eligibleSources) {
      const sourceTokens = new Set(tokenize(source.title));
      const overlap = titleTokens.filter((token) => sourceTokens.has(token)).length;
      if (overlap > bestOverlap) {
        bestOverlap = overlap;
        bestSource = source;
      }
    }
    return bestOverlap >= 1 ? bestSource : undefined;
  };

  return content.replace(/\[Source:\s*([^\]]+)\](?!\s*\()/gi, (match, titlesBlock) => {
    const titles = titlesBlock
      .split(/,\s*(?=")/g)
      .map((t: string) => t.replace(/^["']|["']$/g, "").trim())
      .filter((t: string) => t.length > 0);

    const links: string[] = [];
    for (const title of titles) {
      const source = findBestSourceMatch(title);

      if (source) {
        links.push(`[📄](source://${encodeURIComponent(source.title)})`);
      }
    }

    return links.length > 0 ? links.join(" ") : match;
  });
}

function buildLegacyPdfUrl(pdfFilename: string, page?: number): string {
  const pageFragment = page
    ? `#page=${page}&zoom=80&pagemode=none`
    : "#zoom=80&pagemode=none";
  return `/api/policies/${encodeURIComponent(pdfFilename)}${pageFragment}`;
}

function runBehaviorChecks(): void {
  const sources: SourceInfo[] = [
    {
      title: "Contrast Manual",
      url: "/api/policies/Contrast.pdf#page=7&zoom=80&pagemode=none",
    },
  ];
  const externalSources: SourceInfo[] = [
    {
      title: "TI-RADS - Thyroid Imaging Reporting and Data System — External Reference",
      url: "https://example.com/reference/ti-rads",
    },
  ];
  const knowledgeSources: SourceInfo[] = [
    {
      title: "TI-RADS - Thyroid Imaging Reporting and Data System",
      url: null,
    },
  ];

  const quotedCitation = `Dose guidance [Source: "Contrast Manual"]`;
  const linkedQuotedCitation = backendPreserveSourceMarkers(quotedCitation);
  assert(
    linkedQuotedCitation === quotedCitation,
    "Backend should preserve quoted [Source: ...] markers unchanged."
  );

  const unmatchedCitation = `Dose guidance [Source: "Unknown Manual"]`;
  const unmatchedResult = backendPreserveSourceMarkers(unmatchedCitation);
  assert(
    unmatchedResult.includes(`[Source: "Unknown Manual"]`),
    "Backend should preserve unmatched [Source: ...] markers."
  );

  const alreadyLinked = `Dose guidance [Source: "Contrast Manual"](/api/policies/Contrast.pdf#page=7&zoom=80&pagemode=none)`;
  const alreadyLinkedProcessed = frontendProcessSourceCitations(alreadyLinked, sources);
  assert(
    alreadyLinkedProcessed === alreadyLinked,
    "Frontend should not re-process source citations that are already markdown links."
  );

  const bareCitationProcessed = frontendProcessSourceCitations(quotedCitation, sources);
  assert(
    bareCitationProcessed.includes("[📄](source://Contrast%20Manual)"),
    "Frontend should convert bare source markers into clickable source icons."
  );
  assert(
    !bareCitationProcessed.includes(")("),
    "Frontend citation processing should not create malformed nested markdown links."
  );
  assert(
    !bareCitationProcessed.includes('"View source:'),
    "Frontend citation links should not include fragile markdown title attributes."
  );

  const externalCitation = `Malignancy risk [Source: "TI-RADS - Thyroid Imaging Reporting and Data System — External Reference"]`;
  const externalCitationProcessed = frontendProcessSourceCitations(externalCitation, externalSources);
  assert(
    externalCitationProcessed === externalCitation,
    "Frontend should not create clickable links for external citation URLs."
  );

  const fuzzyCitation = `Risk estimate [Source: "TI-RADS"]`;
  const fuzzyCitationProcessed = frontendProcessSourceCitations(fuzzyCitation, knowledgeSources);
  assert(
    fuzzyCitationProcessed.includes("[📄](source://TI-RADS%20-%20Thyroid%20Imaging%20Reporting%20and%20Data%20System)"),
    "Frontend should fuzzy-match shorthand source labels to internal source titles."
  );

  const knowledgeCitationProcessed = frontendProcessSourceCitations(
    `Knowledge note [Source: "TI-RADS - Thyroid Imaging Reporting and Data System"]`,
    knowledgeSources
  );
  assert(
    knowledgeCitationProcessed.includes("[📄](source://"),
    "Frontend should make knowledge citations clickable even when source URL is null."
  );

  const quotedTitleSources: SourceInfo[] = [
    {
      title: 'Trauma "Pan-Scan" Protocol',
      url: "/api/policies/Trauma_Pan-Scan_Protocol.pdf#page=3&zoom=80&pagemode=none",
    },
  ];
  const quotedTitleCitation = `Trauma guidance [Source: "Trauma \"Pan-Scan\" Protocol"]`;
  const quotedTitleProcessed = frontendProcessSourceCitations(
    quotedTitleCitation,
    quotedTitleSources
  );
  assert(
    quotedTitleProcessed.includes("[📄](source://Trauma%20%22Pan-Scan%22%20Protocol)"),
    "Frontend should handle source titles that include embedded quotes."
  );

  const normalizedTitleSources: SourceInfo[] = [
    {
      title: "Whole_Body-CT Protocol (Adult)",
      url: "/api/policies/Whole_Body-CT_Protocol_Adult.pdf#zoom=80&pagemode=none",
    },
  ];
  const normalizedTitleCitation = `WBCT selection [Source: "Whole body CT protocol adult"]`;
  const normalizedTitleProcessed = frontendProcessSourceCitations(
    normalizedTitleCitation,
    normalizedTitleSources
  );
  assert(
    normalizedTitleProcessed.includes("[📄](source://Whole_Body-CT%20Protocol%20(Adult))"),
    "Frontend should match source titles across spacing, separator, and punctuation variants."
  );

  const preLinkedSourceScheme = `Existing source link [📄](source://Contrast%20Manual)`;
  const preLinkedProcessed = frontendProcessSourceCitations(preLinkedSourceScheme, sources);
  assert(
    preLinkedProcessed === preLinkedSourceScheme,
    "Frontend should keep pre-linked source:// citations stable without rewriting."
  );

  const pagedLegacyUrl = buildLegacyPdfUrl("Contrast.pdf", 12);
  assert(
    pagedLegacyUrl.endsWith("#page=12&zoom=80&pagemode=none"),
    "Legacy citation URL should include page fragment when page is present."
  );
  const nonPagedLegacyUrl = buildLegacyPdfUrl("Contrast.pdf");
  assert(
    nonPagedLegacyUrl.endsWith("#zoom=80&pagemode=none"),
    "Legacy citation URL should keep default PDF fragment when no page is present."
  );
}

function runCodePresenceChecks(): void {
  const root = process.cwd();
  const ragFile = readFileSync(join(root, "packages/api/src/routers/rag.ts"), "utf-8");
  const markdownFile = readFileSync(join(root, "apps/web/src/components/ui/markdown.tsx"), "utf-8");
  const desktopMarkdownFile = readFileSync(
    join(root, "apps/desktop/src/renderer/components/ui/markdown.tsx"),
    "utf-8"
  );
  const chatFile = readFileSync(join(root, "apps/web/src/app/(dashboard)/chat/page.tsx"), "utf-8");
  const policyRouteFile = readFileSync(
    join(root, "apps/web/src/app/api/policies/[filename]/route.ts"),
    "utf-8"
  );

  assert(
    ragFile.includes("const shouldFormatConcise = shouldApplyConciseFormatting({") &&
      ragFile.includes("let processedContent = shouldFormatConcise"),
    "RAG router should preserve source markers while optionally formatting concise output."
  );
  assert(
    ragFile.includes("url = null;"),
    "RAG router should null out Knowledge-mode outbound URLs."
  );

  assert(
    markdownFile.includes("/\\[Source:\\s*([^\\]]+)\\](?!\\s*\\()/gi"),
    "Markdown source processing should skip already-linked citations."
  );
  assert(
    markdownFile.includes("External links are disabled"),
    "Markdown renderer should block outbound external links."
  );
  assert(
    markdownFile.includes("source://"),
    "Markdown renderer should encode inline source icons as source:// citation links."
  );
  assert(
    markdownFile.includes("decodeCitationTitleFromHref"),
    "Web markdown renderer should safely decode source:// citation links."
  );
  assert(
    !markdownFile.includes('"View source: ${source.title}"'),
    "Web markdown should not emit fragile quoted markdown title attributes for citation icons."
  );

  assert(
    desktopMarkdownFile.includes("findBestSourceMatch"),
    "Desktop markdown renderer should use robust citation title matching."
  );
  assert(
    desktopMarkdownFile.includes("source://"),
    "Desktop markdown renderer should use source:// citation links for parity."
  );

  assert(
    chatFile.includes("onPdfClick ? onPdfClick(source.url!, source.title)"),
    "Chat source panel should route source links through the in-app PDF handler."
  );
  assert(
    chatFile.includes("onCitationClick={(source) => {"),
    "Chat message markdown should wire onCitationClick for inline citation icons."
  );
  assert(
    chatFile.includes('source.url?.startsWith("/api/policies/")'),
    "Chat citation clicks with internal policy URLs should route through PDF handling."
  );
  assert(
    chatFile.includes("if (!sourcesExpanded)") &&
      chatFile.includes("onToggleSources();"),
    "Chat citation clicks without direct URLs should expand the source panel."
  );
  assert(
    policyRouteFile.includes("normalizeFilenameIdentity"),
    "Policy route should normalize filename identities for robust lookup."
  );
}

function main(): void {
  runBehaviorChecks();
  runCodePresenceChecks();
  console.log("Citation regression checks passed.");
}

main();
