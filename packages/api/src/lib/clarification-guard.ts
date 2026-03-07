import { getAbbreviationMeanings } from "./medical-abbreviations";
import type { QueryAnalysis } from "./query-analyzer";

const ABBREVIATION_TOKEN_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;

export interface AbbreviationClarificationCandidate {
  abbreviation: string;
  meanings: string[];
}

function normalizeMeaning(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function resolveAbbreviationClarificationCandidate(
  ambiguousTerm: QueryAnalysis["ambiguousTerms"][number] | undefined
): AbbreviationClarificationCandidate | null {
  if (!ambiguousTerm?.term) {
    return null;
  }

  const abbreviation = ambiguousTerm.term.trim().toUpperCase();
  if (!ABBREVIATION_TOKEN_PATTERN.test(abbreviation)) {
    return null;
  }

  const dictionaryEntry = getAbbreviationMeanings(abbreviation);
  if (!dictionaryEntry || dictionaryEntry.meanings.length < 2) {
    return null;
  }

  const dictionaryMeanings = dictionaryEntry.meanings
    .map((meaning) => meaning.trim())
    .filter((meaning) => meaning.length > 0);

  const dictionaryByKey = new Map(
    dictionaryMeanings.map((meaning) => [normalizeMeaning(meaning), meaning])
  );

  const llmMeanings = (ambiguousTerm.possibleMeanings ?? [])
    .map((meaning) => (typeof meaning === "string" ? meaning.trim() : ""))
    .filter((meaning) => meaning.length > 0);

  const intersectedMeanings = [...new Set(
    llmMeanings
      .map((meaning) => dictionaryByKey.get(normalizeMeaning(meaning)))
      .filter((meaning): meaning is string => Boolean(meaning))
  )];

  const selectedMeanings =
    intersectedMeanings.length >= 2 ? intersectedMeanings : dictionaryMeanings;
  const dedupedSelectedMeanings = [...new Set(selectedMeanings)];

  if (dedupedSelectedMeanings.length < 2) {
    return null;
  }

  return {
    abbreviation,
    meanings: dedupedSelectedMeanings,
  };
}
