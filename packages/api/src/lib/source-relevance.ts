const QUERY_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "from",
  "that",
  "this",
  "what",
  "how",
  "are",
  "was",
  "can",
  "does",
  "about",
  "have",
]);

export interface SourceRelevanceCandidate {
  similarity: number;
  document_domain: string;
  document_title: string;
  content: string;
}

export interface SourceRelevanceOptions {
  minDisplaySimilarity: number;
  minDisplaySimilarityKnowledge: number;
  borderlineBuffer?: number;
  borderlineMinOverlap?: number;
}

export interface SourceRelevanceSelection<T> {
  queryTerms: Set<string>;
  relevantResults: T[];
}

function normalizeToWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, "")
    .split(/\s+/)
    .filter((token) => token.length > 0);
}

export function extractSignificantQueryTerms(query: string): Set<string> {
  return new Set(
    normalizeToWords(query).filter(
      (token) => token.length >= 3 && !QUERY_STOPWORDS.has(token)
    )
  );
}

function getDocumentWords(result: SourceRelevanceCandidate): Set<string> {
  const titleWords = normalizeToWords(result.document_title);
  const contentWords = normalizeToWords(result.content.slice(0, 500));
  return new Set([...titleWords, ...contentWords]);
}

export function filterResultsByDisplayRelevance<T extends SourceRelevanceCandidate>(
  searchResults: T[],
  effectiveQuery: string,
  options: SourceRelevanceOptions
): SourceRelevanceSelection<T> {
  const borderlineBuffer = options.borderlineBuffer ?? 0.08;
  const borderlineMinOverlap = options.borderlineMinOverlap ?? 1;
  const queryTerms = extractSignificantQueryTerms(effectiveQuery);

  const relevantResults = searchResults.filter((result) => {
    const similarity = Number(result.similarity);
    const minDisplaySimilarity =
      result.document_domain === "KNOWLEDGE"
        ? options.minDisplaySimilarityKnowledge
        : options.minDisplaySimilarity;

    if (similarity < minDisplaySimilarity) return false;

    // Borderline results need lexical overlap to avoid semantically noisy matches.
    if (similarity < minDisplaySimilarity + borderlineBuffer) {
      const docWords = getDocumentWords(result);
      const overlap = [...queryTerms].filter((term) => docWords.has(term)).length;
      if (overlap < borderlineMinOverlap) return false;
    }

    return true;
  });

  return { queryTerms, relevantResults };
}
