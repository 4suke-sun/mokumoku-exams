import { existsSync } from "node:fs";
import { relative } from "node:path";
import type { Config } from "../config.ts";
import { datasetHash, ERROR_KINDS, type EvalCase, EvalDataError, parseDataset } from "../eval/dataset.ts";
import type { Rate } from "../eval/metrics.ts";
import { pathsFor, readResults } from "../eval/run.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { type Output, report } from "../log.ts";
import { appendRecord, RecordsError, readTuning, TuningRecordSchema, tuningPath } from "../records/store.ts";
import { readAgentStampOrReport } from "../shared/agents.ts";
import { prepareExam } from "../shared/exam.ts";
import { readJsonFile } from "../shared/request-flow.ts";
import { holdCount, parseTargets, sameTargets, sweep } from "./sweep.ts";

/**
 * eval-sweep コマンド: 検証役の評価の結果(`eval` の `--import` 後)に、目標の候補を当てて比べる。モデルも通信も使わない。
 * - eval-sweep <資格コード> --targets=<全体>/<種類ごと>/<誤検出の上限> [--targets=…]   候補ごとの表を出す
 * - eval-sweep <資格コード> --record --reason=<理由> --targets=…                          設定の目標(決めた値)を、比べた表と一緒に台帳へ 1 件足す
 * 決める手順: 表を見て、設定の `eval.targets` を直し(通常の PR)、同じ候補で `--record` する。決めた値が候補に含まれ、
 * 評価が済んでいる(途中・止めたものがない)ときだけ記録する。
 */

export interface SweepOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  candidates: string[];
  record: boolean;
  reason: string | undefined;
  dryRun: boolean;
  output: Output;
  today(): string;
}

const pct = (r: Rate): string =>
  r.rate === null ? "測れない" : `${(r.rate * 100).toFixed(0)}% (${r.numerator}/${r.denominator})`;

export function runEvalSweep(options: SweepOptions): ExitCode {
  const { config, rootDir, examCode, output } = options;
  const exam = prepareExam(options);
  if (!exam.ok) return exam.exit;
  const targets = options.candidates.map(parseTargets);
  if (targets.some((t) => t === null) || targets.length === 0) {
    report(output, "入力の誤り", "--targets は <全体>/<種類ごと>/<誤検出の上限>(0〜1)の形で、1 つ以上");
    return EXIT.inputError;
  }
  const candidates = targets.filter((t) => t !== null);
  const stamp = readAgentStampOrReport(output, rootDir, "question-verifier");
  if (stamp === null) return EXIT.checkFailed;
  const paths = pathsFor(config, rootDir, examCode);
  let cases: EvalCase[];
  let hash: string;
  try {
    if (!existsSync(paths.dataset)) {
      report(output, "入力の誤り", "評価用のデータがない(先に eval を実行する)");
      return EXIT.inputError;
    }
    const dataset = parseDataset(readJsonFile(paths.dataset));
    cases = dataset.cases;
    hash = datasetHash(dataset);
  } catch (error) {
    if (!(error instanceof EvalDataError)) throw error;
    for (const p of error.paths) report(output, "評価用データの誤り", p);
    return EXIT.checkFailed;
  }
  const results = readResults(paths.results);
  const { observed, rows } = sweep(cases, results, candidates);
  report(
    output,
    "評価のしきい値",
    `検証役 ${stamp.model} 定義のハッシュ ${stamp.definitionHash.slice(0, 12)} 評価用データ ${hash.slice(0, 12)}`,
  );
  report(
    output,
    "評価のしきい値",
    `測った指標 検出率(全体) ${pct(observed.detectionOverall)} 誤検出率 ${pct(observed.falsePositive)} 保留 ${holdCount(cases, results)} 件 不採用率(再導出) ${pct(observed.rejectionByStage.rederive)} (解説) ${pct(observed.rejectionByStage.explanation)}`,
  );
  for (const kind of ERROR_KINDS) {
    report(output, "評価のしきい値", `検出率(${kind}) ${pct(observed.detectionByKind[kind])}`);
  }
  for (const row of rows) {
    const t = row.targets;
    report(
      output,
      "評価のしきい値",
      `候補 ${t.detectionOverall}/${t.detectionPerKind}/${t.falsePositiveMax} 目標 ${row.meetsTargets ? "満たした" : "満たしていない"} 下回った ${row.belowTarget.join(",") || "なし"} 測れない ${row.unmeasured.join(",") || "なし"}`,
    );
  }
  if (!options.record) return EXIT.ok;

  const reason = options.reason?.trim() ?? "";
  if (reason === "" || reason.length > 300) {
    report(output, "入力の誤り", "--reason は 1〜300 文字(決めた理由。値や本文は書かない)");
    return EXIT.inputError;
  }
  if (observed.counts.pending > 0 || observed.counts.stopped > 0) {
    report(output, "評価のしきい値", "評価が済んでいない(途中・止めたものがある)ため、記録しない");
    return EXIT.checkFailed;
  }
  const chosen = config.eval.targets;
  if (!candidates.some((c) => sameTargets(c, chosen))) {
    report(output, "評価のしきい値", "設定の eval.targets が、比べた候補に含まれていない(設定を直してから記録する)");
    return EXIT.checkFailed;
  }
  const parsed = TuningRecordSchema.safeParse({
    at: options.today(),
    examCode,
    chosen,
    reason,
    candidates: rows,
    observed: {
      detectionOverall: observed.detectionOverall,
      detectionByKind: observed.detectionByKind,
      falsePositive: observed.falsePositive,
      holds: holdCount(cases, results),
      rejectionRederive: observed.rejectionByStage.rederive,
      rejectionExplanation: observed.rejectionByStage.explanation,
    },
    datasetHash: hash,
    agent: stamp,
  });
  if (!parsed.success) {
    report(
      output,
      "評価の記録の誤り",
      `記録の形が不正: ${parsed.error.issues.map((i) => i.path.join(".") || "(全体)").join(", ")}`,
    );
    return EXIT.checkFailed;
  }
  const path = tuningPath(rootDir, config.recordsDir);
  try {
    const current = readTuning(path);
    if (options.dryRun) report(output, "書き込みをしない(dry-run)");
    else appendRecord(path, current, parsed.data);
  } catch (error) {
    if (!(error instanceof RecordsError)) throw error;
    report(output, "評価の記録の誤り", relative(rootDir, error.file));
    return EXIT.checkFailed;
  }
  report(output, "評価のしきい値", `記録を足した: ${relative(rootDir, path)}`);
  return EXIT.ok;
}

/**
 * 設定の `eval.targets` が、台帳の最新の値と一致しているか。記録がなければ、一致しているとみなす(まだ調整していない)。
 * ずれていれば、場所の説明を返す(値は書かない)。
 */
export function checkTuningConsistency(config: Config, rootDir: string): string[] {
  const records = readTuning(tuningPath(rootDir, config.recordsDir));
  const latest = records.at(-1);
  if (latest === undefined) return [];
  return sameTargets(latest.chosen, config.eval.targets)
    ? []
    : ["設定の eval.targets が、しきい値の台帳の最新の記録と違う(変えたときは、根拠つきの記録を足す)"];
}
