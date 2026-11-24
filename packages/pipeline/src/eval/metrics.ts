import { z } from "zod";
import { ERROR_KINDS, type ErrorKind, type EvalCase } from "./dataset.ts";

/**
 * 検証役の評価の指標。誤りのある例の検出率(種類ごと・全体)、誤りのないものの誤検出率、段階ごとの不採用率を数える。
 * 件数・ID・種類・割合だけを持ち、本文は含めない。分母が 0 の割合は null(0 除算にしない)。
 */

/** 1 件の評価の結果。再導出の結果(合格か保留)と、解説の確認の結果(合格か保留) */
export const CaseResultSchema = z.strictObject({
  rederive: z.enum(["pass", "hold"]).optional(),
  explanation: z.enum(["pass", "hold"]).optional(),
  /** 出力の形が違い、出し直しの上限に達した。先へ進めないので、止めたものとして数える */
  stopped: z.boolean().optional(),
  /** 再導出の選択肢ごとの判定(記号と判定だけ。束の独立性の確かめで、起動ごとの一致を比べるために持つ) */
  choices: z.record(z.string(), z.enum(["correct", "incorrect", "unknown"])).optional(),
  /** 解説の確認の指摘(場所と理由コードだけ。`<場所> <理由コード>` の形) */
  findings: z.array(z.string()).optional(),
});

export type CaseResult = z.infer<typeof CaseResultSchema>;

export type CaseVerdict = "pass" | "hold" | "pending" | "stopped";

/** 結果から、最終の判定を決める */
export function verdictOf(result: CaseResult | undefined): CaseVerdict {
  if (result?.stopped) return "stopped";
  if (result?.rederive === "hold" || result?.explanation === "hold") return "hold";
  if (result?.rederive === "pass" && result.explanation === "pass") return "pass";
  return "pending";
}

export interface Rate {
  numerator: number;
  denominator: number;
  /** 分母が 0 のときは null */
  rate: number | null;
}

const rate = (numerator: number, denominator: number): Rate => ({
  numerator,
  denominator,
  rate: denominator === 0 ? null : numerator / denominator,
});

export interface Targets {
  /** 全体の検出率の下限 */
  detectionOverall: number;
  /** 誤りの種類ごとの検出率の下限 */
  detectionPerKind: number;
  /** 誤検出率の上限 */
  falsePositiveMax: number;
}

export interface Metrics {
  counts: { cases: number; controls: number; faulty: number; finished: number; pending: number; stopped: number };
  /** 誤りのある例を、保留か不採用にした割合 */
  detectionOverall: Rate;
  detectionByKind: Record<ErrorKind, Rate>;
  /** 誤りのある例を、合格にした割合(見落とし) */
  missRate: Rate;
  /** 誤りのないものを、保留か不採用にした割合 */
  falsePositive: Rate;
  /** 段階ごとの不採用率(その段階に進んだものに対する、保留か不採用にした割合) */
  rejectionByStage: { rederive: Rate; explanation: Rate };
  meetsTargets: boolean;
  /** 目標を判定できなかった項目(分母が 0 など) */
  unmeasured: string[];
  /** 目標を下回った項目 */
  belowTarget: string[];
}

export function computeMetrics(
  cases: readonly EvalCase[],
  results: Readonly<Record<string, CaseResult>>,
  targets: Targets,
): Metrics {
  const verdicts = cases.map((c) => ({ c, v: verdictOf(results[c.caseId]) }));
  const finished = verdicts.filter((x) => x.v === "pass" || x.v === "hold");
  const faulty = finished.filter((x) => x.c.kind !== "control");
  const controls = finished.filter((x) => x.c.kind === "control");
  const detectionByKind = Object.fromEntries(
    ERROR_KINDS.map((kind) => {
      const ofKind = faulty.filter((x) => x.c.kind === kind);
      return [kind, rate(ofKind.filter((x) => x.v === "hold").length, ofKind.length)];
    }),
  ) as Record<ErrorKind, Rate>;
  const detectionOverall = rate(faulty.filter((x) => x.v === "hold").length, faulty.length);
  const falsePositive = rate(controls.filter((x) => x.v === "hold").length, controls.length);
  // 段階ごと: 再導出に進んだもの(結果がある)、解説の確認に進んだもの(再導出が合格)
  const reachedRederive = cases.filter((c) => results[c.caseId]?.rederive !== undefined);
  const reachedExplanation = cases.filter((c) => results[c.caseId]?.explanation !== undefined);
  const rejectionByStage = {
    rederive: rate(
      reachedRederive.filter((c) => results[c.caseId]?.rederive === "hold").length,
      reachedRederive.length,
    ),
    explanation: rate(
      reachedExplanation.filter((c) => results[c.caseId]?.explanation === "hold").length,
      reachedExplanation.length,
    ),
  };

  const unmeasured: string[] = [];
  const belowTarget: string[] = [];
  const check = (name: string, r: Rate, ok: (value: number) => boolean) => {
    if (r.rate === null) unmeasured.push(name);
    else if (!ok(r.rate)) belowTarget.push(name);
  };
  check("detectionOverall", detectionOverall, (v) => v >= targets.detectionOverall);
  for (const kind of ERROR_KINDS) {
    check(`detection:${kind}`, detectionByKind[kind], (v) => v >= targets.detectionPerKind);
  }
  check("falsePositive", falsePositive, (v) => v <= targets.falsePositiveMax);
  const pending = verdicts.filter((x) => x.v === "pending").length;
  const stopped = verdicts.filter((x) => x.v === "stopped").length;
  return {
    counts: {
      cases: cases.length,
      controls: cases.filter((c) => c.kind === "control").length,
      faulty: cases.filter((c) => c.kind !== "control").length,
      finished: finished.length,
      pending,
      stopped,
    },
    detectionOverall,
    detectionByKind,
    missRate: rate(faulty.filter((x) => x.v === "pass").length, faulty.length),
    falsePositive,
    rejectionByStage,
    // 未測定の項目、下回った項目、未完了(進行中・止めた)のものがあれば、目標を満たしたとはしない
    meetsTargets: unmeasured.length === 0 && belowTarget.length === 0 && pending === 0 && stopped === 0,
    unmeasured,
    belowTarget,
  };
}
