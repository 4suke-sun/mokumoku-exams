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
  /** 問題の来歴の置き場(資格ごとの JSON。コミットする) */
  provenanceDir: z.string().min(1),
  /** 人の判断の記録の置き場(資格ごとの JSON。コミットする) */
  decisionsDir: z.string().min(1),
  /** 収集の計画の置き場(資格ごとの JSON。コミットする) */
  plansDir: z.string().min(1),
  /** 評価の記録の置き場(しきい値の調整の台帳と、評価の関門の合格の記録。コミットする) */
  recordsDir: z.string().min(1),
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
    /** 設問文の類似度(0〜1)のしきい値。duplicate 以上は重複として落とし、hold 以上は保留にして確かめる */
    similarity: z
      .strictObject({ duplicate: z.number().min(0).max(1), hold: z.number().min(0).max(1) })
      .refine((v) => v.hold < v.duplicate, "保留のしきい値は、重複のしきい値より小さくする"),
  }),
  /** 出典の候補の提案 */
  candidates: z.strictObject({
    /** 出題範囲の項目 1 つあたりの候補の数の上限 */
    maxPerItem: z.number().int().min(1).max(20),
    /** 依頼 1 件の取り込みを、形の検査に通らずにやり直せる回数の上限 */
    maxAttempts: z.number().int().positive(),
  }),
  /** 人の確認(全件の確認と、リスクの高いものを優先した抜き取りの切り替え) */
  review: z.strictObject({
    /** full は通過したものを全件確認する。sample は、検証役の評価が目標を満たしたときだけ、抜き取りにする */
    mode: z.enum(["full", "sample"]),
    /** 抜き取りの率(0〜1)。通過したものの件数に対する、確認する件数の割合の下限 */
    rate: z.number().min(0).max(1),
    /** 抜き取りの乱数の種(同じ入力・率・種から、同じものが選ばれる) */
    seed: z.number().int().min(0),
    /** 重複の類似度が、保留のしきい値からこの幅以内なら「保留に近い」 */
    nearHoldMargin: z.number().min(0).max(1),
    /** この点数以上のものは、率にかかわらず全件を確認する */
    highRiskScore: z.number().int().min(1).max(4),
    /** 抜き取りで人が却下した割合が、これを超えたら全件の確認へ戻す */
    maxRejectRate: z.number().min(0).max(1),
    /** 戻すかを判断するのに必要な、人の判断の最小の件数 */
    minDecisions: z.number().int().positive(),
    /**
     * 基準を満たした下書きを、人の承認なしで書き出せる試験(export/criteria.ts)。
     * 基準を満たさない下書きは、これまでどおり人の承認が要る。挙げない試験は変わらない
     */
    autoApprove: z.array(z.string().regex(EXAM_CODE)).default([]),
  }),
  /** 検証役の評価 */
  eval: z.strictObject({
    /** 評価用のデータを作る乱数の種(同じ種なら同じデータ) */
    seed: z.number().int().min(0),
    /** 仕込む誤りの種類ごとの件数の目安 */
    perKind: z.number().int().min(1).max(50),
    /** 依頼 1 件の取り込みを、形の検査に通らずにやり直せる回数の上限 */
    maxAttempts: z.number().int().positive(),
    /** 指標の目標(docs/evaluation.md) */
    targets: z.strictObject({
      detectionOverall: z.number().min(0).max(1),
      detectionPerKind: z.number().min(0).max(1),
      falsePositiveMax: z.number().min(0).max(1),
    }),
  }),
  /** 検証 */
  verify: z.strictObject({
    /** 依頼 1 件の取り込みを、形の検査に通らずにやり直せる回数の上限 */
    maxAttempts: z.number().int().positive(),
  }),
  /** 判定(公開している問題の質の判定)と、判定役の評価 */
  judge: z.strictObject({
    /** 依頼 1 件の取り込みを、形の検査に通らずにやり直せる回数の上限 */
    maxAttempts: z.number().int().positive(),
    /** 判定役の評価(docs/evaluation.md) */
    eval: z.strictObject({
      /** 評価用のデータを作る乱数の種(同じ種なら同じデータ) */
      seed: z.number().int().min(0),
      /** 仕込む欠陥の種類ごとの件数の目安 */
      perKind: z.number().int().min(1).max(50),
      /** 指標の目標 */
      targets: z.strictObject({
        detectionOverall: z.number().min(0).max(1),
        detectionPerKind: z.number().min(0).max(1),
        falsePositiveMax: z.number().min(0).max(1),
      }),
    }),
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
        /**
         * 対象サービスごとの目標(試験ガイドの対象サービスの一覧を使う)。事実カードの選び方で寄せる(plan/services.ts)。
         * 持たない試験は、サービスで寄せない
         */
        services: z
          .strictObject({
            /**
             * 各サービスが出る問題の数の下限。下書きの依頼の重みは、公開済みの問題と、不採用でない本文のある下書きの合計で数える。
             * plan の報告は、公開済みの問題だけで数える
             */
            minPerService: z.number().int().min(0).max(1000),
            /** 1 つのサービスが出る問題の割合の上限 */
            maxShare: z.number().gt(0).max(1),
            /** サービスが 2 つ以上出る問題の割合の下限。score の束の警告に使う(持たなければ見ない) */
            minMultiServiceShare: z.number().min(0).max(1).optional(),
          })
          .optional(),
        /**
         * 論点の枠。分野の不足とは別に、決まった論点の問題を、決まった数だけ作る(plan の項目に足す)。
         * 依頼に載せる事実カードを、出典の URL の接頭辞で絞り(分野は問わない)、問いの形の一言を依頼に添える
         */
        focus: z
          .array(
            z.strictObject({
              /** 枠の名前。計画の項目の ID のもとになる(変えると、別の項目として数え直す) */
              id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),
              domain: z.string().regex(/^domain[1-9][0-9]?$/),
              difficulty: z.enum(["easy", "medium", "hard"]),
              kind: z.enum(["single", "multiple"]),
              /** 作る問題の数(不採用でない下書きの数で数える) */
              count: z.number().int().min(1).max(50),
              /** 根拠にする事実カードの出典の URL の接頭辞。どれかで始まる出典を持つカードだけを載せる */
              sourcePrefixes: z.array(z.string().startsWith("https://").max(2000)).min(1).max(10),
              /** 問いの形の一言。依頼にそのまま載る */
              instruction: z.string().min(1).max(300),
            }),
          )
          .max(20)
          .optional(),
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
