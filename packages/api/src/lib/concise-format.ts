const SOURCE_CITATION_PATTERN = /\[Source:\s*[^\]]+\]/gi;
const ELLIPSIS_TOKEN = "__RAD_ASSIST_ELLIPSIS__";
const CITATION_TOKEN_PREFIX = "__RAD_ASSIST_CITATION_";

function normalizeExcessiveWhitespace(value: string): string {
  return value
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "")
    .replace(/\n{4,}/g, "\n\n\n") // Preserve paragraph structure while preventing huge gaps.
    .trim();
}

function protectSourceCitations(value: string): { contentWithTokens: string; citations: string[] } {
  const citations: string[] = [];
  const contentWithTokens = value.replace(SOURCE_CITATION_PATTERN, (match) => {
    const token = `${CITATION_TOKEN_PREFIX}${citations.length}__`;
    citations.push(match);
    return token;
  });

  return { contentWithTokens, citations };
}

function restoreSourceCitations(value: string, citations: string[]): string {
  return citations.reduce((output, citation, index) => {
    const token = `${CITATION_TOKEN_PREFIX}${index}__`;
    return output.replace(new RegExp(token, "g"), citation);
  }, value);
}

function cleanupPunctuationArtifacts(value: string): string {
  return value
    .replace(/\.{3}/g, ELLIPSIS_TOKEN)
    .replace(/:\s*\./g, ":")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/([?!])\./g, "$1")
    .replace(/\.\.(?!\.)/g, ".")
    .replace(new RegExp(ELLIPSIS_TOKEN, "g"), "...");
}

export function shouldApplyConciseFormatting(params: {
  isConciseOutput: boolean;
  severity: "routine" | "urgent" | "emergency";
  currentBranch?: string;
}): boolean {
  if (!params.isConciseOutput) return false;
  return params.severity === "routine";
}

export function formatConciseResponse(rawContent: string): string {
  if (!rawContent.trim()) return rawContent.trim();
  const { contentWithTokens, citations } = protectSourceCitations(rawContent);
  const normalized = normalizeExcessiveWhitespace(contentWithTokens);
  const cleaned = cleanupPunctuationArtifacts(normalized);
  return restoreSourceCitations(cleaned, citations);
}
