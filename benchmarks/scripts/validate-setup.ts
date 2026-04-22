#!/usr/bin/env npx tsx

import { execFileSync } from "child_process";
import { loadConfig } from "../harness/runner";
import { listModels } from "../harness/ollama-client";

function printCheck(ok: boolean, label: string, detail: string): void {
  console.log(`${ok ? "✅" : "❌"} ${label}: ${detail}`);
}

function printWarn(label: string, detail: string): void {
  console.log(`⚠️  ${label}: ${detail}`);
}

async function main(): Promise<void> {
  const { models, settings } = loadConfig();
  let fatal = false;

  const wiredLimitMb = Number(execFileSync("sysctl", ["-n", "iogpu.wired_limit_mb"], { encoding: "utf-8" }).trim());
  const wiredOk = wiredLimitMb >= 100_000;
  printCheck(wiredOk, "iogpu.wired_limit_mb", `${wiredLimitMb} MB`);
  fatal ||= !wiredOk;

  let ollamaModels: string[] = [];
  try {
    ollamaModels = (await listModels(settings.ollama_base_url)).map((model) => model.name);
    printCheck(true, "Ollama", `${settings.ollama_base_url} reachable (${ollamaModels.length} models visible)`);
  } catch (error) {
    printCheck(false, "Ollama", error instanceof Error ? error.message : String(error));
    fatal = true;
  }

  const missingModels = models.filter((model) => !ollamaModels.includes(model.tag)).map((model) => model.tag);
  if (missingModels.length > 0) {
    printWarn("Missing models", missingModels.join(", "));
  } else {
    printCheck(true, "Model matrix", "All nine benchmark models are present");
  }

  const anthropicConfigured = typeof process.env.ANTHROPIC_API_KEY === "string" && process.env.ANTHROPIC_API_KEY.length > 0;
  if (anthropicConfigured) {
    printCheck(true, "ANTHROPIC_API_KEY", "present");
  } else {
    printWarn("ANTHROPIC_API_KEY", "judge disabled; latency/programmatic-only runs still work");
  }

  const databaseConfigured = typeof process.env.DATABASE_URL === "string" && process.env.DATABASE_URL.length > 0;
  printCheck(databaseConfigured, "DATABASE_URL", databaseConfigured ? "present" : "missing");
  fatal ||= !databaseConfigured;

  const hasOpenAiEmbeddings = typeof process.env.OPENAI_API_KEY === "string" && process.env.OPENAI_API_KEY.length > 0;
  const hasLocalEmbeddings =
    typeof process.env.LOCAL_LLM_URL === "string" &&
    process.env.LOCAL_LLM_URL.length > 0 &&
    typeof process.env.EMBEDDING_MODEL === "string" &&
    process.env.EMBEDDING_MODEL.length > 0;
  const embeddingsConfigured = hasOpenAiEmbeddings || hasLocalEmbeddings;
  printCheck(
    embeddingsConfigured,
    "Embedding provider",
    hasOpenAiEmbeddings
      ? "OPENAI_API_KEY available"
      : hasLocalEmbeddings
        ? `LOCAL_LLM_URL + EMBEDDING_MODEL (${process.env.EMBEDDING_MODEL})`
        : "missing",
  );
  fatal ||= !embeddingsConfigured;

  const homeDir = process.env.HOME || "~";
  const dfOutput = execFileSync("df", ["-Pk", homeDir], { encoding: "utf-8" }).trim().split("\n");
  const diskColumns = dfOutput[dfOutput.length - 1].trim().split(/\s+/);
  const availableKb = Number(diskColumns[3] || 0);
  const availableGb = availableKb / 1024 / 1024;
  const diskOk = availableGb >= 50;
  printCheck(diskOk, "Free disk on $HOME", `${availableGb.toFixed(1)} GB available`);
  fatal ||= !diskOk;

  const hardware = execFileSync("sysctl", ["-n", "machdep.cpu.brand_string"], { encoding: "utf-8" }).trim();
  const macos = execFileSync("sw_vers", ["-productVersion"], { encoding: "utf-8" }).trim();
  printCheck(true, "Hardware", `${hardware} on macOS ${macos}`);

  process.exit(fatal ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
