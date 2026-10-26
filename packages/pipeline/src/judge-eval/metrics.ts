import { z } from "zod";
import type { Rate } from "../eval/metrics.ts";
import { JUDGE_CODES, JUDGE_VERDICTS } from "../judge/schema.ts";
import { DEFECT_KINDS, type DefectKind, EXPECTED_CODES, type JudgeEvalCase } from "./dataset.ts";

/**
 * 判定役の評価の指標。基準を満たさない例の検出率(欠陥の種類ごと・全体)、基準を満たすものの誤検出率、理由コードの一致率を数える。
 * 件数・ID・種類・割合だけを持ち、本文は含めない。分母が 0 の割合は null(0 除算にしない)。
 */

/** 1 件の評価の結果 */
export const JudgeCaseResultSchema = z.strictObject({
  verdict: z.enum(JUDGE_VERDICTS).optional(),
  codes: z.array(z.enum(JUDGE_CODES)).max(20).optional(),
  /** 出力の形が違い、出し直しの上限に達した。先へ進めないので、止めたものとして数える */
  stopped: z.boolean().optional(),
});
export type JudgeCaseResult = z.infer<typeof JudgeCaseResultSchema>;

export type CaseVerdict = "publish" | "flagged" | "pending" | "stopped";

/** 結果から、最終の判定を決める。publish 以外(rewritable・unpublish)は、基準を満たさないと判定した(flagged) */
export function caseVerdictOf(result: JudgeCaseResult | undefined): CaseVerdict {
  if (result?.stopped) return "stopped";
  if (result?.verdict === undefined) return "pending";
  return result.verdict === "publish" ? "publish" : "flagged";
}

const rate = (numerator: number, denominator: number): Rate => ({
  numerator,
  denominator,
  rate: denominator === 0 ? null : numerator / denominator,
});

export interface JudgeTargets {
  detectionOverall: number;
  detectionPerKind: number;
  falsePositiveMax: number;
}

export interface JudgeMetrics {
  counts: { cases: number; controls: number; faulty: number; finished: number; pending: number; stopped: number };
  detectionOverall: Rate;
  detectionByKind: Record<DefectKind, Rate>;
  /** 基準を満たさない例を、publish にした割合(見落とし) */
  missRate: Rate;
  /** 基準を満たすものを、publish 以外にした割合(誤検出) */
  falsePositive: Rate;
  /** 検出した変種のうち、期待する理由コードを 1 つ以上挙げたものの割合(目標は持たない) */
  codeMatch: Rate;
  meetsTargets: boolean;
  unmeasured: string[];
  belowTarget: string[];
}

export function computeJudgeMetrics(
  cases: readonly JudgeEvalCase[],
  results: Readonly<Record<string, JudgeCaseResult>>,
  targets: JudgeTargets,
): JudgeMetrics {
  const verdicts = cases.map((c) => ({ c, v: caseVerdictOf(results[c.caseId]) }));
  const finished = verdicts.filter((x) => x.v === "publish" || x.v === "flagged");
  const faulty = finished.filter((x) => x.c.kind !== "control");
  const controls = finished.filter((x) => x.c.kind === "control");
  const detectionByKind = Object.fromEntries(
    DEFECT_KINDS.map((kind) => {
      const ofKind = faulty.filter((x) => x.c.kind === kind);
      return [kind, rate(ofKind.filter((x) => x.v === "flagged").length, ofKind.length)];
    }),
  ) as Record<DefectKind, Rate>;
  const detected = faulty.filter((x) => x.v === "flagged");
  const matched = detected.filter((x) => {
    const expected = EXPECTED_CODES[x.c.kind as DefectKind] as readonly string[];
    return (results[x.c.caseId]?.codes ?? []).some((code) => expected.includes(code));
  });
  const detectionOverall = rate(detected.length, faulty.length);
  const falsePositive = rate(controls.filter((x) => x.v === "flagged").length, controls.length);

  const unmeasured: string[] = [];
  const belowTarget: string[] = [];
  const check = (name: string, r: Rate, ok: (value: number) => boolean) => {
    if (r.rate === null) unmeasured.push(name);
    else if (!ok(r.rate)) belowTarget.push(name);
  };
  check("detectionOverall", detectionOverall, (v) => v >= targets.detectionOverall);
  for (const kind of DEFECT_KINDS)
    check(`detection:${kind}`, detectionByKind[kind], (v) => v >= targets.detectionPerKind);
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
    missRate: rate(faulty.filter((x) => x.v === "publish").length, faulty.length),
    falsePositive,
    codeMatch: rate(matched.length, detected.length),
    meetsTargets: unmeasured.length === 0 && belowTarget.length === 0 && pending === 0 && stopped === 0,
    unmeasured,
    belowTarget,
  };
}
