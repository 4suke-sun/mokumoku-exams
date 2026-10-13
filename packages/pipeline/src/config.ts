import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import { EXAM_CODE } from "./contract.ts";

/** 配分の合計が 1 になること(許容誤差 0.001) */
const sumsToOne = (mix: Record<string, number>) => Math.abs(Object.values(mix).reduce((a, b) => a + b, 0) - 1) <= 0.001;

const share = z.number().min(0).max(1);
export const DifficultyMixSchema = z
  .strictObject({ easy: share, medium: share, hard: share })
  .refine(sumsToOne, "配分の合計が 1 ではありません");
export const TypeMixSchema = z
  .strictObject({ single: share, multiple: share, "free-text": share })
  .refine(sumsToOne, "配分の合計が 1 ではありません");

export const ConfigSchema = z.strictObject({
  /** 作業用の置き場(取得した本文、段階の成果物)。リポジトリ直下からの相対パス */
  workDir: z.string().min(1),
  /** 出典の台帳の置き場(資格ごとの JSON。コミットする) */
  ledgerDir: z.string().min(1),
  /** 事実カードの置き場(資格ごとの JSON。コミットする) */
  factsDir: z.string().min(1),
  /** 収集の計画の置き場(資格ごとの JSON。コミットする) */
  plansDir: z.string().min(1),
  /** 資格マスタ(読み取り専用で参照する) */
  examsFile: z.string().min(1),
  /** 1 回の実行で扱う件数の上限(費用の管理)。収集では、取得する URL の数の上限 */
  maxItemsPerRun: z.number().int().positive(),
  /** 出典の取得。相手に負担をかけないための間隔と上限 */
  fetch: z.strictObject({
    /** 同じホストへの、取得の開始の間隔 */
    perHostIntervalMs: z.number().int().min(0),
    /** 同じホストへの、同時の取得の数 */
    perHostConcurrency: z.number().int().positive(),
    /** 全体の同時の取得の数 */
    maxConcurrency: z.number().int().positive(),
    timeoutMs: z.number().int().positive(),
    /** 本文の大きさの上限(バイト) */
    maxBytes: z.number().int().positive(),
    maxRedirects: z.number().int().min(0),
    /** 取得元を示す。連絡先などの個人情報や環境固有の値は入れない */
    userAgent: z.string().min(1),
  }),
  /** 取得した本文の作業用キャッシュ */
  cache: z.strictObject({
    retentionDays: z.number().int().positive(),
    maxBytes: z.number().int().positive(),
  }),
  /** 事実カード */
  facts: z.strictObject({
    /** 出典 1 件の抽出を、検査に通らずにやり直せる回数の上限 */
    maxAttempts: z.number().int().positive(),
    /** レビューレポートの抜き取りの乱数の種(同じ種なら同じ抜き取り) */
    sampleSeed: z.number().int().min(0),
    /** 抜き取りで、分野ごとに選ぶ件数の上限 */
    samplePerDomain: z.number().int().positive(),
  }),
  /** 下書き */
  draft: z.strictObject({
    /** 依頼 1 件の取り込みを、形の検査に通らずにやり直せる回数の上限 */
    maxAttempts: z.number().int().positive(),
    /** 依頼 1 件で書かせる下書きの数の上限 */
    maxPerRequest: z.number().int().positive(),
    /** 依頼 1 件に載せる事実カードの数の上限 */
    maxFactsPerRequest: z.number().int().positive(),
    /** 計画の項目 1 つについて、全件が不採用になったとき、依頼を出し直せる回数の上限 */
    maxRounds: z.number().int().positive(),
  }),
  /** 出題計画。目標の問題数と、難易度・種別の配分(試験ごとに overrides で上書きする) */
  plan: z.strictObject({
    /** 目標の問題数 = 本番の出題数 × この倍率(問題の蓄えを、1 回の出題より多くする) */
    targetMultiplier: z.number().positive().max(100),
    difficultyMix: DifficultyMixSchema,
    typeMix: TypeMixSchema,
    overrides: z.record(
      z.string().regex(EXAM_CODE),
      z.strictObject({
        targetTotal: z.number().int().positive().optional(),
        difficultyMix: DifficultyMixSchema.optional(),
        typeMix: TypeMixSchema.optional(),
      }),
    ),
  }),
  checks: z.strictObject({
    /** 出典の更新日が、この日数以内なら新しいとみなす */
    freshnessDays: z.number().int().positive(),
  }),
});

export type Config = z.infer<typeof ConfigSchema>;

/** 項目名だけを持つ。値は持たない */
export class ConfigError extends Error {
  readonly missing: string[];
  readonly invalid: string[];
  constructor(missing: string[], invalid: string[]) {
    super("設定の誤り");
    this.missing = missing;
    this.invalid = invalid;
  }
}

/** 設定ファイル(コミットする、環境値を含まない)を読み、環境値(.env)で上書きできるものを上書きする */
export function loadConfig(configPath: string, env: Record<string, string | undefined>): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new ConfigError(Object.keys(ConfigSchema.shape), []);
  }
  const merged = { ...(typeof raw === "object" && raw !== null ? raw : {}) } as Record<string, unknown>;
  if (env.PIPELINE_WORK_DIR) merged.workDir = env.PIPELINE_WORK_DIR;
  const parsed = ConfigSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys") {
      invalid.push("(未知の項目)");
      continue;
    }
    const name = String(issue.path[0] ?? "(不明)");
    // issue.message や入力値は使わない。項目名だけを集める。値がなければ欠落、あれば不正
    (merged[name] === undefined ? missing : invalid).push(name);
  }
  throw new ConfigError([...new Set(missing)], [...new Set(invalid)]);
}

export function defaultConfigPath(): string {
  return resolve(import.meta.dirname, "../pipeline.config.json");
}
