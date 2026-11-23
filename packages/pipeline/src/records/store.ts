import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { sha256 } from "../collect/fetcher.ts";
import { ERROR_KINDS } from "../eval/dataset.ts";
import { writeJson } from "../shared/fs.ts";

/**
 * 評価の記録(コミットする台帳)。しきい値の調整(tuning.json)と、評価の関門の合格(eval-gate.json)。
 * 件数・割合・ハッシュ・理由の短い文だけを持ち、問題の本文は持たない。根拠が欠ける記録は足せず、形の違う記録が台帳にあるときは、読むときに台帳全体を失敗にする(RecordsError)。
 */

const HASH = z.string().regex(/^[0-9a-f]{64}$/);
const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const SHARE = z.number().min(0).max(1);

export const TargetsSchema = z.strictObject({
  detectionOverall: SHARE,
  detectionPerKind: SHARE,
  falsePositiveMax: SHARE,
});

const RateSchema = z.strictObject({
  numerator: z.number().int().min(0),
  denominator: z.number().int().min(0),
  rate: z.number().min(0).max(1).nullable(),
});

const AgentSchema = z.strictObject({
  role: z.string().min(1),
  model: z.string().min(1),
  definitionHash: HASH,
});

export const TuningRecordSchema = z
  .strictObject({
    at: DATE,
    examCode: z.string().min(1),
    /** 決めた値(記録の時点の、設定の目標) */
    chosen: TargetsSchema,
    /** 決めた理由。値や本文は書かない */
    reason: z.string().trim().min(1).max(300),
    /** 比べた候補。決めた値を含む */
    candidates: z
      .array(
        z.strictObject({
          targets: TargetsSchema,
          meetsTargets: z.boolean(),
          belowTarget: z.array(z.string()),
          unmeasured: z.array(z.string()),
        }),
      )
      .min(1),
    /** 測った指標(候補によらない) */
    observed: z.strictObject({
      detectionOverall: RateSchema,
      detectionByKind: z.strictObject(Object.fromEntries(ERROR_KINDS.map((k) => [k, RateSchema])) as never),
      falsePositive: RateSchema,
      holds: z.number().int().min(0),
      rejectionRederive: RateSchema,
      rejectionExplanation: RateSchema,
    }),
    datasetHash: HASH,
    agent: AgentSchema,
  })
  .refine(
    (r) =>
      r.candidates.some(
        (c) =>
          c.targets.detectionOverall === r.chosen.detectionOverall &&
          c.targets.detectionPerKind === r.chosen.detectionPerKind &&
          c.targets.falsePositiveMax === r.chosen.falsePositiveMax,
      ),
    "決めた値が、比べた候補に含まれていません",
  );

export type TuningRecord = z.infer<typeof TuningRecordSchema>;

export const GateRecordSchema = z
  .strictObject({
    at: DATE,
    role: z.enum(["verifier", "judge"]),
    /** 評価の対象(役の定義と、設定)のハッシュ */
    subjectHash: HASH,
    agent: AgentSchema,
    settingsHash: HASH,
    /** 合格したレポート。本文は含まない */
    reports: z
      .array(
        z.strictObject({
          examCode: z.string().min(1),
          datasetHash: HASH,
          cases: z.number().int().min(1),
          /** 判定役のレポートの、判定の基準のハッシュ(記録のため。関門の対象には含めない) */
          criteriaHash: HASH.optional(),
        }),
      )
      .min(1),
  })
  .refine(
    (r) => sha256(`${r.agent.definitionHash}\n${r.settingsHash}`) === r.subjectHash,
    "対象のハッシュが、役の定義と設定のハッシュから決まる値と違います",
  )
  .refine(
    (r) => r.agent.role === (r.role === "verifier" ? "question-verifier" : "question-judge"),
    "役の名前が、記録の役と対応しません",
  );

export type GateRecord = z.infer<typeof GateRecordSchema>;

export class RecordsError extends Error {
  readonly file: string;
  constructor(file: string) {
    super("評価の記録の誤り");
    this.file = file;
  }
}

function read<T>(path: string, schema: z.ZodType<T>): T[] {
  if (!existsSync(path)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new RecordsError(path);
  }
  const parsed = z.strictObject({ records: z.array(schema) }).safeParse(raw);
  if (!parsed.success) throw new RecordsError(path);
  return parsed.data.records;
}

export const tuningPath = (rootDir: string, recordsDir: string): string =>
  join(resolve(rootDir, recordsDir), "tuning.json");
export const gatePath = (rootDir: string, recordsDir: string): string =>
  join(resolve(rootDir, recordsDir), "eval-gate.json");

export const readTuning = (path: string): TuningRecord[] => read(path, TuningRecordSchema);
export const readGate = (path: string): GateRecord[] => read(path, GateRecordSchema);

/** 追記する(記録は消さない。履歴は、台帳の順番で読める) */
export function appendRecord<T>(path: string, current: T[], added: T): void {
  writeJson(path, { records: [...current, added] });
}
