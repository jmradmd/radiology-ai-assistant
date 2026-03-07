/**
 * Archived citation-link behavior (Feb 2026).
 *
 * This module preserves the previous runtime logic that converted:
 *   [Source: "Document Title"]
 * into markdown hyperlinks by matching source titles to URLs.
 *
 * Current policy is internal-only citations:
 * - Keep [Source: "..."] tokens in model output.
 * - Render compact citation icons in the client.
 * - Disable outbound external links at runtime.
 *
 * Keep this file for future restoration/reference only.
 */

export interface LegacyCitationSource {
  title: string;
  url: string | null;
}

function normalizeCitationTitle(value: string): string {
  return value
    .trim()
    .replace(/^["']+|["']+$/g, "")
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Legacy helper that rewrites [Source: ...] markers into markdown links.
 * Not used in current runtime path.
 */
export function legacyRewriteSourceCitations(
  content: string,
  sources: LegacyCitationSource[],
  isKnowledgeMode: boolean
): string {
  const titleToUrl = new Map<string, string>();

  for (const source of sources) {
    const normalizedTitle = normalizeCitationTitle(source.title);
    if (source.url) {
      titleToUrl.set(normalizedTitle, source.url);
    }
  }

  if (isKnowledgeMode) {
    for (const source of sources) {
      const cleanTitle = normalizeCitationTitle(
        source.title.replace(
          /\s*—\s*(External Knowledge Source|Radiology Reference|Reference Database)$/i,
          ""
        )
      );

      if (source.url && cleanTitle !== normalizeCitationTitle(source.title)) {
        titleToUrl.set(cleanTitle, source.url);
      }
    }
  }

  return content.replace(/\[Source:\s*([^\]]+)\]/gi, (match, title) => {
    const normalizedTitle = normalizeCitationTitle(title);
    const url = titleToUrl.get(normalizedTitle);
    if (!url) return match;
    return `[Source: ${title.trim()}](${url})`;
  });
}
