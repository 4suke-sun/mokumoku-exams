import type { EvalCase } from "../eval/dataset.ts";
import { type CaseResult, computeMetrics, type Metrics, type Targets } from "../eval/metrics.ts";

/**
 * 目標のしきい値の候補を、1 回の評価の結果に当てて比べる。測った指標(検出率・誤検出率・件数)は、候補によらない。
 * 候補ごとに変わるのは、目標を満たしたか、下回った項目、測れなかった項目である。モデルは呼ばない。
 */

export interface SweepRow {
  targets: Targets;
  meetsTargets: boolean;
  belowTarget: string[];
  unmeasured: string[];
}

export interface SweepResult {
  observed: Metrics;
  rows: SweepRow[];
}

const SHARE = /^(?:0(?:\.\d+)?|1(?:\.0+)?)$/;

/** `<全体>/<種類ごと>/<誤検出の上限>`(0〜1)の候補。形が違えば null。 */
export function parseTargets(text: string): Targets | null {
  const parts = text.split("/");
  if (parts.length !== 3 || !parts.every((p) => SHARE.test(p))) return null;
  const [detectionOverall, detectionPerKind, falsePositiveMax] = parts.map(Number) as [number, number, number];
  return { detectionOverall, detectionPerKind, falsePositiveMax };
}

export const sameTargets = (a: Targets, b: Targets): boolean =>
  a.detectionOverall === b.detectionOverall &&
  a.detectionPerKind === b.detectionPerKind &&
  a.falsePositiveMax === b.falsePositiveMax;

export function sweep(
  cases: readonly EvalCase[],
  results: Readonly<Record<string, CaseResult>>,
  candidates: readonly Targets[],
): SweepResult {
  const metrics = candidates.map((t) => computeMetrics(cases, results, t));
  const rows = candidates.map((targets, i) => {
    const m = metrics[i] as Metrics;
    return { targets, meetsTargets: m.meetsTargets, belowTarget: m.belowTarget, unmeasured: m.unmeasured };
  });
  // 候補がなければ、目標を気にしない指標だけを測る
  const observed =
    metrics[0] ?? computeMetrics(cases, results, { detectionOverall: 0, detectionPerKind: 0, falsePositiveMax: 1 });
  return { observed, rows };
}

/** 保留にした件数(誤りのある例と、対照の両方) */
export function holdCount(cases: readonly EvalCase[], results: Readonly<Record<string, CaseResult>>): number {
  return cases.filter((c) => results[c.caseId]?.rederive === "hold" || results[c.caseId]?.explanation === "hold")
    .length;
}
