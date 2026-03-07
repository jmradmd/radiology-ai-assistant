export interface InlineClarification {
  detected: true;
  options: string[];
  term: string;
  preamble: string;
}

const ABBREVIATION_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/;
const LEGACY_CLARIFICATION_PATTERN =
  /^I noticed you used ["']?([A-Z][A-Z0-9]{1,9})["']? which can mean several things:\s*\n\n([\s\S]*?)\n\nWhich meaning did you intend\?(?:\s*\(You can reply with the number or the full term\))?\s*$/i;
const LEGACY_OPTION_PATTERN = /^\d+\.\s*(?:\*\*)?(.+?)(?:\*\*)?\s*$/;

export function detectInlineClarification(
  content: string
): InlineClarification | null {
  const match = content.match(LEGACY_CLARIFICATION_PATTERN);
  if (!match) {
    return null;
  }

  const term = match[1]?.trim().toUpperCase();
  if (!term || !ABBREVIATION_PATTERN.test(term)) {
    return null;
  }

  const options = match[2]
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => {
      const optionMatch = line.match(LEGACY_OPTION_PATTERN);
      return optionMatch?.[1]?.trim() ?? "";
    })
    .filter((option) => option.length > 0);

  const dedupedOptions = [...new Set(options)];
  if (dedupedOptions.length < 2) {
    return null;
  }

  return {
    detected: true,
    options: dedupedOptions,
    term,
    preamble: `What does "${term}" mean in this context?`,
  };
}
