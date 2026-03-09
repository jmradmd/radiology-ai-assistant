# Evaluation Framework

Systematic validation of Radiology AI Assistant safety modules, retrieval accuracy, and cross-model consistency.

## Architecture

The evaluation framework has three tiers, each with increasing infrastructure requirements:

| Tier | What it tests | Requirements | Run time |
|------|--------------|-------------|----------|
| **1: Unit Tests** | Individual module logic (emergency detection, PHI filtering, abbreviation disambiguation, routing rules, response validation, source relevance) | None (pure TypeScript) | ~5 seconds |
| **2: Pipeline Evaluation** | Gold-standard cases against safety modules. Verifies correct behavior across emergency, PHI, abbreviation, and routing dimensions simultaneously. | None for offline checks. Seeded DB for retrieval checks. | ~10 seconds offline |
| **3: Cross-Model Comparison** | Same queries across multiple LLM providers. Route agreement, content overlap, LLM-as-judge quality scoring. | Running server + DB + 2+ LLM API keys | ~2-5 minutes |

## Quick Start

```bash
# Tier 1: Run all unit tests (no setup needed)
npx tsx evaluation/scripts/eval-unit.ts

# Tier 2: Run gold-standard pipeline evaluation (no DB needed for most checks)
npx tsx evaluation/scripts/eval-pipeline.ts --skip-retrieval

# Tier 2 with retrieval (requires seeded DB)
npx tsx scripts/seed-demo.ts        # seed demo data first
npx tsx evaluation/scripts/eval-pipeline.ts

# Tier 3: Cross-model comparison (requires running server + multiple API keys)
npx tsx evaluation/scripts/eval-cross-model.ts --models claude-haiku,gpt-4o
```

## Gold-Standard Dataset

The core evaluation asset is `evaluation/datasets/gold-standard.json`. Each entry specifies a query with known-correct behavior across multiple dimensions.

### Case categories

- **retrieval**: Tests whether the correct protocol document is retrieved for a given query
- **emergency_detection**: Tests severity classification and trigger/escalator identification
- **phi_detection**: Tests PHI detection sensitivity (catches real PHI) and specificity (does not flag eponyms, IT systems, clinical terms)
- **abbreviation**: Tests context-dependent disambiguation (MS = multiple sclerosis vs. mitral stenosis)
- **routing**: Tests PROTOCOL / KNOWLEDGE / HYBRID classification
- **response_validation**: Tests that generated responses follow safety rules (no first-person advice, no unqualified invasive recommendations, no disposition language)

### Extending the dataset

Add entries to the `cases` array in `gold-standard.json`. Each case needs:

1. A unique `id` (convention: category prefix + number, e.g. `retr-007`)
2. A `category` matching one of the categories above
3. A `query` (the user input to test)
4. An `expected` object with assertions relevant to that category

Not all assertion fields are required. A retrieval case can also include emergency assertions to test that a protocol question does not trigger false-positive emergency detection.

### Working with institutional data

The gold-standard dataset is designed to work against the demo data created by `scripts/seed-demo.ts`. When deploying with real institutional protocols:

1. Seed your institutional documents: `npx tsx scripts/ingest-institution.ts --institution YOUR_INST`
2. Create institution-specific gold-standard entries referencing your actual document titles and categories
3. Save as `evaluation/datasets/gold-standard-YOUR_INST.json`
4. Run: `npx tsx evaluation/scripts/eval-pipeline.ts --dataset gold-standard-YOUR_INST.json`

This separation ensures the open-source repo never contains institutional data while still providing a complete evaluation methodology.

## Results

All evaluation runs produce timestamped JSON reports in `evaluation/results/`. These reports include:

- Pass/fail for every individual check
- Category-level breakdowns
- Overall pass rates
- Full assertion details for failed checks

The `results/` directory is gitignored to avoid committing local evaluation data.

## What This Framework Answers

**For the retrieval validation question ("are queries sourcing the right documents?"):**
Tier 2 retrieval evaluation with `mustAppearInTop` assertions. Run against seeded data, measure Recall@K.

**For the cross-model consistency question ("same question, different model, same answer?"):**
Tier 3 cross-model evaluation. Route agreement rate + critical content overlap + LLM-as-judge scoring.

**For contributor safety ("did my change break emergency detection?"):**
Tier 1 unit tests. Run `npx tsx evaluation/scripts/eval-unit.ts` before pushing.

## Adding New Tests

### New unit test for an existing module

Add test cases to the existing `.test.ts` file next to the module. Example:

```typescript
// packages/api/src/lib/emergency-detection.test.ts
test("detects status epilepticus as emergency", () => {
  const assessment = assessEmergency("patient in status epilepticus, refractory to lorazepam");
  assert.equal(assessment.severity, "emergency");
});
```

### New gold-standard case

Add to `evaluation/datasets/gold-standard.json`:

```json
{
  "id": "emrg-009",
  "category": "emergency_detection",
  "query": "tension pneumothorax, tracheal deviation, hemodynamically unstable",
  "description": "Tension pneumothorax with hemodynamic instability",
  "expected": {
    "emergency": {
      "severity": "emergency",
      "isEmergency": true,
      "triggersMustInclude": ["tension pneumothorax"]
    }
  }
}
```

### New test module

1. Create `packages/api/src/lib/your-module.test.ts`
2. Use `node:test` and `node:assert/strict` (matches existing convention)
3. The Tier 1 runner discovers it automatically

## CI Integration

To add evaluation to a GitHub Actions workflow:

```yaml
- name: Tier 1 Unit Tests
  run: npx tsx evaluation/scripts/eval-unit.ts

- name: Tier 2 Pipeline Evaluation
  run: npx tsx evaluation/scripts/eval-pipeline.ts --skip-retrieval
```

Tier 3 requires infrastructure and API keys, so it runs manually or on a schedule rather than on every PR.
