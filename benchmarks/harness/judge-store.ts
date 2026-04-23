import { appendFileSync, existsSync, mkdirSync, readFileSync } from "fs";
import { resolve } from "path";
import { z } from "zod";
import { judgeScoreSetSchema } from "./schema";
import type { JudgeScoreSet } from "./types";

export const judgeRecordSchema = z.object({
  run_id: z.string().min(1),
  model_tag: z.string().min(1),
  query_id: z.string().min(1),
  run_number: z.number().int().min(0),
  scored_utc: z.string().datetime(),
  judge_scores: judgeScoreSetSchema,
  backup_judge_scores: judgeScoreSetSchema.nullable(),
  error: z
    .object({
      kind: z.enum(["judge_error", "judge_timeout", "judge_schema_violation"]),
      message: z.string(),
    })
    .nullable(),
});

export type JudgeRecord = z.infer<typeof judgeRecordSchema>;

export function judgeKey(params: {
  model_tag: string;
  query_id: string;
  run_number: number;
}): string {
  return `${params.model_tag}::${params.query_id}::${params.run_number}`;
}

export function loadJudgeRecords(path: string): JudgeRecord[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => judgeRecordSchema.parse(JSON.parse(line)));
}

export function buildJudgeIndex(records: JudgeRecord[]): Map<string, JudgeRecord> {
  const index = new Map<string, JudgeRecord>();
  for (const record of records) {
    index.set(
      judgeKey({ model_tag: record.model_tag, query_id: record.query_id, run_number: record.run_number }),
      record,
    );
  }
  return index;
}

export function appendJudgeRecord(path: string, record: JudgeRecord): void {
  mkdirSync(resolve(path, ".."), { recursive: true });
  const validated = judgeRecordSchema.parse(record);
  appendFileSync(path, `${JSON.stringify(validated)}\n`);
}

export function mergeJudgeIntoRun<T extends {
  model_tag: string;
  query_id: string;
  run_number: number;
  judge_scores: JudgeScoreSet | null;
  backup_judge_scores?: JudgeScoreSet | null;
}>(run: T, index: Map<string, JudgeRecord>): T {
  const record = index.get(judgeKey(run));
  if (!record) return run;
  return {
    ...run,
    judge_scores: record.judge_scores,
    backup_judge_scores: record.backup_judge_scores,
  };
}
