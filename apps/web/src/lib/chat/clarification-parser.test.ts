import test from "node:test";
import assert from "node:assert/strict";
import { detectInlineClarification } from "./clarification-parser";

test("parses strict legacy clarification template", () => {
  const content = `I noticed you used "MS" which can mean several things:

1. **multiple sclerosis**
2. **mitral stenosis**
3. **morphine sulfate**

Which meaning did you intend?`;

  const result = detectInlineClarification(content);

  assert.deepEqual(result, {
    detected: true,
    term: "MS",
    options: ["multiple sclerosis", "mitral stenosis", "morphine sulfate"],
    preamble: 'What does "MS" mean in this context?',
  });
});

test("does not parse normal narrative text with similar wording", () => {
  const content =
    'The word "which" can mean several things in English, but in your question it is just a connector and not a medical abbreviation.';

  const result = detectInlineClarification(content);

  assert.equal(result, null);
});
