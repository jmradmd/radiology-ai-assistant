#!/usr/bin/env npx tsx
import { readFileSync } from "fs";
import { resolve } from "path";
import { queryCaseSchema, multiTurnCaseSchema } from "../harness/schema";

const target = process.argv[2];
if (!target) {
  console.error("usage: validate-queries.ts <path-to-jsonl> [--multi-turn]");
  process.exit(1);
}
const isMultiTurn = process.argv.includes("--multi-turn");
const schema = isMultiTurn ? multiTurnCaseSchema : queryCaseSchema;

const lines = readFileSync(resolve(target), "utf-8").split("\n").filter((l) => l.trim());
let failures = 0;
const ids = new Set<string>();
for (const [i, line] of lines.entries()) {
  try {
    const parsed = schema.parse(JSON.parse(line));
    if (ids.has(parsed.id)) {
      console.error(`Duplicate id on line ${i + 1}: ${parsed.id}`);
      failures += 1;
    }
    ids.add(parsed.id);
  } catch (e: any) {
    console.error(`Line ${i + 1} failure:`, String(e.message).slice(0, 500));
    failures += 1;
  }
}
console.log(`Parsed ${lines.length} rows, ${failures} failures, ${ids.size} unique ids`);
process.exit(failures === 0 ? 0 : 1);
