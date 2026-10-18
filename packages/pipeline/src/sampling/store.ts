import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EXAM_CODE } from "../contract.ts";
import { PathsError } from "../shared/errors.ts";
import { writeFileAtomic } from "../shared/fs.ts";
import type { SamplingPlan } from "./plan.ts";

/**
 * 抜き取りの記録。資格ごとに 1 つの JSON を、人の判断の記録のそばに置く(コミットする)。
 * 持つのは、モード・率・種・件数・確認するものと確認しないものの ID・全件の確認のままにした理由だけで、本文は含まない。
 * 書き出しは、この記録の「確認しない下書き」を、承認なしで書き出してよいものとして読む。
 */

const ID_LIST = z.array(z.string().min(1)).max(100000);

export const SamplingRecordSchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE),
  requested: z.enum(["full", "sample"]),
  mode: z.enum(["full", "sample"]),
  fallback: z.enum(["not-requested", "eval-missing", "eval-not-met", "eval-stale", "reject-rate-high"]).nullable(),
  rate: z.number().min(0).max(1),
  seed: z.number().int().min(0),
  rejectRate: z.number().min(0).max(1).nullable(),
  evalDefinitionHash: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  draft: z.strictObject({ eligible: z.number().int().min(0), reviewed: ID_LIST, notReviewed: ID_LIST }),
  fact: z.strictObject({ eligible: z.number().int().min(0), reviewed: ID_LIST, notReviewed: ID_LIST }),
});

export type SamplingRecord = z.infer<typeof SamplingRecordSchema>;

export class SamplingError extends PathsError {
  constructor(paths: string[]) {
    super("抜き取りの記録の誤り", paths);
  }
}

export function samplingPath(decisionsDir: string, examCode: string): string {
  return join(decisionsDir, `${examCode.toLowerCase()}.sampling.json`);
}

export function recordOf(examCode: string, plan: SamplingPlan): SamplingRecord {
  return { examCode, ...plan };
}

/** 読む。なければ null。形が違えば場所だけを持つ誤り */
export function readSampling(path: string, examCode: string): SamplingRecord | null {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new SamplingError(["(JSON の形)"]);
  }
  const parsed = SamplingRecordSchema.safeParse(raw);
  if (!parsed.success) throw new SamplingError(parsed.error.issues.map((i) => i.path.join(".") || "(全体)"));
  if (parsed.data.examCode !== examCode) throw new SamplingError(["examCode"]);
  return parsed.data;
}

export function writeSampling(path: string, record: SamplingRecord): void {
  const checked = SamplingRecordSchema.parse(record);
  writeFileAtomic(path, `${JSON.stringify(checked, null, 2)}\n`);
}
