#!/usr/bin/env npx tsx
/**
 * Tier 1 Evaluation: Unit Tests
 *
 * Runs all *.test.ts files across the monorepo using Node's built-in test runner.
 * No database, no API keys, no network required.
 *
 * Usage:
 *   npx tsx evaluation/scripts/eval-unit.ts
 *   npx tsx evaluation/scripts/eval-unit.ts --verbose
 *   npx tsx evaluation/scripts/eval-unit.ts --json   # machine-readable output
 */

import { execSync } from "child_process";
import { resolve, relative } from "path";
import { readdirSync, statSync, writeFileSync, mkdirSync } from "fs";

const ROOT = resolve(__dirname, "..", "..");
const RESULTS_DIR = resolve(__dirname, "..", "results");
const VERBOSE = process.argv.includes("--verbose");
const JSON_OUTPUT = process.argv.includes("--json");

// ════════════════════════════════════════════════════════════════════════════
// DISCOVER TEST FILES
// ════════════════════════════════════════════════════════════════════════════

function findTestFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = resolve(dir, entry);
    if (entry === "node_modules" || entry === ".git" || entry === "archive") continue;
    if (statSync(full).isDirectory()) {
      results.push(...findTestFiles(full));
    } else if (entry.endsWith(".test.ts") || entry.endsWith(".test.tsx")) {
      results.push(full);
    }
  }
  return results;
}

// ════════════════════════════════════════════════════════════════════════════
// RUN TESTS
// ════════════════════════════════════════════════════════════════════════════

interface TestFileResult {
  file: string;
  relativePath: string;
  passed: boolean;
  output: string;
  passCount: number;
  failCount: number;
  duration: number;
}

function runTestFile(filePath: string): TestFileResult {
  const relativePath = relative(ROOT, filePath);
  const start = Date.now();

  try {
    // node:test requires --experimental-strip-types for .ts files on Node < 22
    // tsx handles this transparently
    const output = execSync(
      `npx tsx --test "${filePath}"`,
      {
        cwd: ROOT,
        timeout: 30_000,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, NODE_ENV: "test" },
      }
    );

    const passCount = (output.match(/# pass \d+/g) || []).reduce(
      (sum, m) => sum + parseInt(m.replace("# pass ", "")),
      0
    );
    const failCount = (output.match(/# fail \d+/g) || []).reduce(
      (sum, m) => sum + parseInt(m.replace("# fail ", "")),
      0
    );

    return {
      file: filePath,
      relativePath,
      passed: failCount === 0,
      output,
      passCount: passCount || output.split("ok").length - 1,
      failCount,
      duration: Date.now() - start,
    };
  } catch (error: any) {
    const output = (error.stdout || "") + "\n" + (error.stderr || "");
    const failMatches = output.match(/# fail (\d+)/);
    const passMatches = output.match(/# pass (\d+)/);

    return {
      file: filePath,
      relativePath,
      passed: false,
      output,
      passCount: passMatches ? parseInt(passMatches[1]) : 0,
      failCount: failMatches ? parseInt(failMatches[1]) : 1,
      duration: Date.now() - start,
    };
  }
}

// ════════════════════════════════════════════════════════════════════════════
// MAIN
// ════════════════════════════════════════════════════════════════════════════

const testFiles = findTestFiles(ROOT);

if (testFiles.length === 0) {
  console.error("No test files found.");
  process.exit(1);
}

console.log(`\nRadiology AI Assistant — Tier 1 Unit Tests`);
console.log(`═══════════════════════════════════════════`);
console.log(`Found ${testFiles.length} test files\n`);

const results: TestFileResult[] = [];
let totalPass = 0;
let totalFail = 0;

for (const file of testFiles) {
  const result = runTestFile(file);
  results.push(result);
  totalPass += result.passCount;
  totalFail += result.failCount;

  const icon = result.passed ? "✅" : "❌";
  const timing = `${result.duration}ms`;
  console.log(
    `${icon} ${result.relativePath}  (${result.passCount} passed, ${result.failCount} failed, ${timing})`
  );

  if (VERBOSE && !result.passed) {
    console.log(`\n--- FAILURES ---\n${result.output}\n--- END ---\n`);
  }
}

// ════════════════════════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════════════════════════

const allPassed = totalFail === 0;
const passRate = totalPass + totalFail > 0
  ? ((totalPass / (totalPass + totalFail)) * 100).toFixed(1)
  : "N/A";

console.log(`\n═══════════════════════════════════════════`);
console.log(`SUMMARY: ${totalPass} passed, ${totalFail} failed (${passRate}% pass rate)`);
console.log(`STATUS:  ${allPassed ? "ALL PASSING ✅" : "FAILURES DETECTED ❌"}`);
console.log(`═══════════════════════════════════════════\n`);

// ════════════════════════════════════════════════════════════════════════════
// PERSIST RESULTS
// ════════════════════════════════════════════════════════════════════════════

mkdirSync(RESULTS_DIR, { recursive: true });

const report = {
  timestamp: new Date().toISOString(),
  tier: 1,
  label: "unit-tests",
  totalFiles: testFiles.length,
  totalPass,
  totalFail,
  passRate: parseFloat(passRate) || 0,
  allPassed,
  files: results.map((r) => ({
    path: r.relativePath,
    passed: r.passed,
    passCount: r.passCount,
    failCount: r.failCount,
    durationMs: r.duration,
  })),
};

const filename = `unit-tests-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
writeFileSync(resolve(RESULTS_DIR, filename), JSON.stringify(report, null, 2));

if (JSON_OUTPUT) {
  console.log(JSON.stringify(report, null, 2));
}

process.exit(allPassed ? 0 : 1);
