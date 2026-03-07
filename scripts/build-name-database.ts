import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

function readNamesFile(path: string): string[] {
  const content = readFileSync(path, "utf-8");
  return content
    .split(/\r?\n/)
    .map((line) => line.trim().toLowerCase())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .map((line) => line.replace(/[^a-z'-]/g, ""))
    .filter((line) => line.length >= 2);
}

function toTsArrayLiteral(values: string[]): string {
  return values.map((value) => `  "${value}",`).join("\n");
}

function uniqueSorted(values: string[]): string[] {
  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b));
}

const workspaceRoot = resolve(__dirname, "..");
const firstNamesPath = resolve(workspaceRoot, "scripts/name-data/first-names.txt");
const lastNamesPath = resolve(workspaceRoot, "scripts/name-data/last-names.txt");
const outputPath = resolve(workspaceRoot, "packages/shared/src/data/name-database.generated.ts");

const firstNames = uniqueSorted(readNamesFile(firstNamesPath));
const lastNames = uniqueSorted(readNamesFile(lastNamesPath));

const output = `/**
 * Generated name database.
 *
 * Source of truth for updates:
 * - scripts/name-data/first-names.txt
 * - scripts/name-data/last-names.txt
 *
 * Regenerate with:
 * npm run build:name-db
 */

export const RAW_FIRST_NAMES = [
${toTsArrayLiteral(firstNames)}
] as const;

export const RAW_LAST_NAMES = [
${toTsArrayLiteral(lastNames)}
] as const;
`;

writeFileSync(outputPath, output, "utf-8");

console.log(`Wrote ${firstNames.length} first names and ${lastNames.length} last names to ${outputPath}`);
