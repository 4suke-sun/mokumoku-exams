import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.ts";
import { DecisionsError, decisionsPath, draftDecision, readDecisions } from "../decisions/decisions.ts";
import { DraftsError, draftWorkDir, readDrafts } from "../draft/store.ts";
import type { Rate } from "../eval/metrics.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { checkJudgeOutput } from "../judge/check.ts";
import { type Criteria, readCriteria } from "../judge/criteria.ts";
import { inputFromDraft, type JudgeInput, toScoreInput } from "../judge/input.ts";
import { buildJudgeRequest, JudgeRequestSchema, judgeKey } from "../judge/request.ts";
import { JudgeOutputSchema } from "../judge/schema.ts";
import { type Output, report } from "../log.ts";
import { resolveProfile } from "../scorecard/profiles.ts";
import { questionPasses, scoreQuestion } from "../scorecard/score.ts";
import { type AgentStamp, readAgentStampOrReport } from "../shared/agents.ts";
import { prepareExam } from "../shared/exam.ts";
import { writeFileAtomic, writeJson } from "../shared/fs.ts";
import {
  cleanupImported,
  definitionChanged,
  discardStale,
  type FlowContext,
  failOutput,
  listRequestFiles,
  readJsonFile,
  reportStop,
} from "../shared/request-flow.ts";
import {
  buildJudgeDataset,
  DEFECT_KINDS,
  DEFECT_LABEL,
  JudgeEvalDataError,
  type JudgeEvalDataset,
  judgeDatasetHash,
  parseJudgeDataset,
} from "./dataset.ts";
import {
  caseVerdictOf,
  computeJudgeMetrics,
  type JudgeCaseResult,
  JudgeCaseResultSchema,
  type JudgeMetrics,
} from "./metrics.ts";

/**
 * judge-eval コマンド: 判定役(question-judge)の見落としと誤検出を数字で測る(ADR 0021)。
 * - judge-eval <資格コード>            評価用のデータ(なければ作る)から、判定の依頼を作業用の置き場に書く
 * - judge-eval <資格コード> --import   判定役の出力を、期待する判定と照合して取り込み、レポートを書く
 * モデルも API キーも使わない。評価用のデータは、人が承認し、点数票の機械の観点を満たす下書きから作る。`data/` は変えない。
 */

export type JudgeEvalMode = "request" | "import";

export interface JudgeEvalOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  mode: JudgeEvalMode;
  dryRun: boolean;
  output: Output;
  /** 今日の日付(YYYY-MM-DD)。レポートに載せる */
  today(): string;
}

interface Paths {
  drafts: string;
  decisions: string;
  dir: string;
  dataset: string;
  results: string;
  state: string;
  requestsDir: string;
  outDir: string;
  reportJson: string;
  reportMd: string;
}

function pathsFor(config: Config, rootDir: string, examCode: string): Paths {
  const work = resolve(rootDir, config.workDir);
  const dir = join(work, "judge-eval", examCode.toLowerCase());
  return {
    drafts: join(draftWorkDir(work, examCode), "drafts.json"),
    decisions: decisionsPath(resolve(rootDir, config.decisionsDir), examCode),
    dir,
    dataset: join(dir, "dataset.json"),
    results: join(dir, "results.json"),
    state: join(dir, "state.json"),
    requestsDir: join(dir, "requests"),
    outDir: join(dir, "out"),
    reportJson: join(dir, "report.json"),
    reportMd: join(dir, "report.md"),
  };
}

const ResultsFileSchema = z.record(z.string(), JudgeCaseResultSchema);

function readResults(path: string): Record<string, JudgeCaseResult> {
  const raw = existsSync(path) ? readJsonFile(path) : undefined;
  const parsed = ResultsFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

function readAttempts(path: string): Record<string, number> {
  const raw = existsSync(path) ? readJsonFile(path) : undefined;
  if (raw === null || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number")) as Record<string, number>;
}

interface Context {
  options: JudgeEvalOptions;
  paths: Paths;
  dataset: JudgeEvalDataset;
  criteria: Criteria;
  stamp: AgentStamp;
  profile: NonNullable<ReturnType<typeof resolveProfile>>;
}

export function runJudgeEval(options: JudgeEvalOptions): ExitCode {
  const { config, rootDir, examCode, output } = options;
  const exam = prepareExam(options);
  if (!exam.ok) return exam.exit;
  const profile = resolveProfile(examCode);
  if (profile === null) {
    report(output, "入力の誤り", "点数票の帯がない資格");
    return EXIT.inputError;
  }
  const criteria = readCriteria(rootDir, examCode);
  if (criteria === null) {
    report(output, "入力の誤り", "判定の基準がない(資格別の文書に「判定の基準」の節がない)");
    return EXIT.inputError;
  }
  const stamp = readAgentStampOrReport(output, rootDir, "question-judge");
  if (stamp === null) return EXIT.checkFailed;
  const paths = pathsFor(config, rootDir, examCode);
  let dataset: JudgeEvalDataset | null = null;
  try {
    if (existsSync(paths.dataset)) dataset = parseJudgeDataset(readJsonFile(paths.dataset));
  } catch (error) {
    if (!(error instanceof JudgeEvalDataError)) throw error;
    for (const p of error.paths) report(output, "評価用データの誤り", p);
    return EXIT.checkFailed;
  }
  if (dataset === null) {
    const made = createDataset(options, paths, profile);
    if (typeof made === "number") return made;
    dataset = made;
  }
  const ctx: Context = { options, paths, dataset, criteria, stamp, profile };
  return options.mode === "request" ? requestStep(ctx) : importStep(ctx);
}

/** 人が承認した選択式の下書きのうち、点数票の機械の観点を満たすものから、評価用のデータを作って書く */
function createDataset(
  options: JudgeEvalOptions,
  paths: Paths,
  profile: Context["profile"],
): JudgeEvalDataset | ExitCode {
  const { config, examCode, output, dryRun } = options;
  let bases: { id: string; input: JudgeInput }[];
  let approved = 0;
  try {
    const drafts = readDrafts(paths.drafts, examCode);
    const decisions = readDecisions(paths.decisions, examCode);
    bases = drafts.drafts.flatMap((d) => {
      const draft = d.draft;
      if (draft === null || !("choices" in draft) || draftDecision(decisions, d.id) !== "approve") return [];
      approved++;
      const input = inputFromDraft(d.id, draft);
      // 機械の観点を満たさない下書きは、「基準を満たす」対照にしない
      return questionPasses(scoreQuestion(toScoreInput(input), profile)) ? [{ id: d.id, input }] : [];
    });
  } catch (error) {
    if (error instanceof DraftsError) for (const p of error.paths) report(output, "下書きの誤り", p);
    else if (error instanceof DecisionsError) for (const p of error.paths) report(output, "判断の記録の誤り", p);
    else throw error;
    return EXIT.checkFailed;
  }
  if (bases.length === 0) {
    report(output, "入力の誤り", "人が承認し、機械の観点を満たす選択式の下書きがない(評価用のデータを作れない)");
    return EXIT.inputError;
  }
  const { dataset, skipped } = buildJudgeDataset(examCode, bases, {
    seed: config.judge.eval.seed,
    perKind: config.judge.eval.perKind,
  });
  for (const kind of DEFECT_KINDS) {
    if (skipped[kind] > 0) report(output, "情報", `評価用のデータ: ${kind} は ${skipped[kind]} 件を作れなかった`);
  }
  report(
    output,
    "情報",
    `評価用のデータ: 対照 ${dataset.cases.filter((c) => c.kind === "control").length} 件、欠陥のある例 ${dataset.cases.filter((c) => c.kind !== "control").length} 件(種 ${dataset.seed}、元の下書き ${bases.length} 件、承認した選択式 ${approved} 件)`,
  );
  if (!dryRun) writeJson(paths.dataset, dataset);
  return dataset;
}

function requestStep(ctx: Context): ExitCode {
  const { options, paths, dataset, criteria, stamp, profile } = ctx;
  const { config, rootDir, examCode, output, dryRun } = options;
  const results = readResults(paths.results);
  let requested = 0;
  let pending = 0;
  let finished = 0;
  let exhausted = 0;
  let limited = false;
  for (const c of dataset.cases) {
    const verdict = caseVerdictOf(results[c.caseId]);
    if (verdict === "publish" || verdict === "flagged") {
      finished++;
      continue;
    }
    if (verdict === "stopped") {
      exhausted++;
      continue;
    }
    const key = judgeKey(c.input, criteria, stamp.definitionHash);
    const requestPath = join(paths.requestsDir, `${key}.json`);
    if (existsSync(requestPath)) {
      pending++;
      continue;
    }
    if (requested >= config.maxItemsPerRun) {
      limited = true;
      break;
    }
    const score = scoreQuestion(toScoreInput(c.input), profile);
    const request = buildJudgeRequest({
      examCode,
      key,
      input: c.input,
      criteria,
      machine: { total: score.total, lost: score.lost, candidate: !questionPasses(score) },
      outputPath: relative(rootDir, join(paths.outDir, `${key}.json`)),
      stamp,
    });
    if (!dryRun) writeJson(requestPath, request);
    report(output, "評価の依頼", relative(rootDir, requestPath));
    requested++;
  }
  report(
    output,
    "情報",
    `依頼 ${requested} 件、依頼済みで待っている ${pending} 件、評価が済んだ ${finished} 件、止めた ${exhausted} 件`,
  );
  if (dryRun) report(output, "書き込みをしない(dry-run)");
  if (limited) report(output, "件数の上限", "maxItemsPerRun(再実行で続きから進む)");
  return limited || exhausted > 0 ? EXIT.checkFailed : EXIT.ok;
}

function importStep(ctx: Context): ExitCode {
  const { options, paths, dataset, criteria, stamp } = ctx;
  const { config, output, dryRun } = options;
  const flow: FlowContext = { output, stopLabel: "評価の取り込みの停止", dryRun };
  const attempts = readAttempts(paths.state);
  const results = readResults(paths.results);
  const resultsBefore = JSON.stringify(results);
  const doneFiles: string[] = [];
  let failures = 0;

  for (const file of listRequestFiles(paths.requestsDir)) {
    const key = file.replace(/\.json$/, "");
    const outPath = join(paths.outDir, file);
    if (!existsSync(outPath)) {
      report(output, "評価の出力なし", key);
      continue;
    }
    const requestPath = join(paths.requestsDir, file);
    const parsedRequest = JudgeRequestSchema.safeParse(readJsonFile(requestPath));
    if (!parsedRequest.success || parsedRequest.data.requestKey !== key) {
      reportStop(flow, key, "request-invalid");
      failures++;
      continue;
    }
    const request = parsedRequest.data;
    const c = dataset.cases.find((x) => x.caseId === request.questionId);
    // 依頼のあとに、定義・データ・判定の基準が変わった。出力の形を見る前に、依頼を作り直す
    const stale =
      definitionChanged(request, stamp) ||
      c === undefined ||
      judgeKey(c.input, criteria, stamp.definitionHash) !== key ||
      caseVerdictOf(results[c.caseId]) !== "pending";
    if (stale) {
      discardStale(flow, key, requestPath, outPath);
      continue;
    }
    const fail = (reason: string) => {
      failOutput(flow, key, reason, outPath, attempts);
      failures++;
      // 上限に達したものは、先へ進めないので、止めたものとして数える
      if (!dryRun && (attempts[key] ?? 0) >= config.judge.maxAttempts) results[c.caseId] = { stopped: true };
    };
    const parsed = JudgeOutputSchema.safeParse(readJsonFile(outPath));
    if (!parsed.success) {
      fail("output-invalid");
      continue;
    }
    const checked = checkJudgeOutput(request, parsed.data);
    if (!checked.ok) {
      fail(checked.reason);
      continue;
    }
    results[c.caseId] = {
      verdict: parsed.data.verdict,
      codes: [...new Set(parsed.data.findings.map((f) => f.code))].sort(),
    };
    doneFiles.push(file);
  }

  const metrics = computeJudgeMetrics(dataset.cases, results, config.judge.eval.targets);
  report(
    output,
    "情報",
    `取り込み: 評価が済んだ ${metrics.counts.finished} 件、途中 ${metrics.counts.pending} 件、止めた ${metrics.counts.stopped} 件、停止 ${failures} 件`,
  );
  reportMetrics(output, metrics);
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return failures > 0 ? EXIT.checkFailed : EXIT.ok;
  }
  if (JSON.stringify(results) !== resultsBefore) writeJson(paths.results, results);
  writeJson(paths.state, attempts);
  cleanupImported(doneFiles, paths.requestsDir, paths.outDir);
  const body = buildReport(ctx, metrics);
  writeJson(paths.reportJson, body);
  writeFileAtomic(paths.reportMd, renderReport(body));
  report(output, "レビューレポート", relative(options.rootDir, paths.reportMd));
  report(output, "レビューレポート", relative(options.rootDir, paths.reportJson));
  return failures > 0 ? EXIT.checkFailed : EXIT.ok;
}

const pct = (r: { rate: number | null }) => (r.rate === null ? "-" : `${(r.rate * 100).toFixed(1)}%`);

function reportMetrics(output: Output, m: JudgeMetrics): void {
  const line = (label: string, r: Rate) =>
    report(output, "評価の指標", `${label} ${pct(r)} ${r.numerator}/${r.denominator}`);
  line("検出率(全体)", m.detectionOverall);
  for (const kind of DEFECT_KINDS) line(`検出率(${kind})`, m.detectionByKind[kind]);
  line("見落とし率", m.missRate);
  line("誤検出率", m.falsePositive);
  line("理由コードの一致率", m.codeMatch);
  report(output, "評価の指標", `目標 ${m.meetsTargets ? "満たした" : "満たしていない"}`);
}

/** レポート。どの判定役の定義・モデル・判定の基準・評価用のデータで測ったかが分かる。件数・ID・種類だけを持ち、本文は含まない */
export function buildReport(ctx: Context, metrics: JudgeMetrics) {
  const { options, dataset, stamp, criteria } = ctx;
  return {
    examCode: options.examCode,
    date: options.today(),
    agent: stamp,
    criteriaHash: criteria.hash,
    dataset: {
      hash: judgeDatasetHash(dataset),
      seed: dataset.seed,
      perKind: dataset.perKind,
      cases: dataset.cases.length,
      caseIds: dataset.cases.map((c) => ({ caseId: c.caseId, baseDraftId: c.baseDraftId, kind: c.kind })),
    },
    targets: options.config.judge.eval.targets,
    metrics,
  };
}

export type JudgeEvalReport = ReturnType<typeof buildReport>;

export function renderReport(r: JudgeEvalReport): string {
  const m = r.metrics;
  const row = (label: string, x: Rate) => `| ${label} | ${x.numerator} | ${x.denominator} | ${pct(x)} |`;
  return `${[
    `# 判定役の評価(${r.examCode})`,
    "",
    `- 実行日: ${r.date}`,
    `- 判定役: ${r.agent.role}(モデル ${r.agent.model}、定義のハッシュ ${r.agent.definitionHash})`,
    `- 判定の基準のハッシュ: ${r.criteriaHash}`,
    `- 評価用のデータ: ハッシュ ${r.dataset.hash}、種 ${r.dataset.seed}、件数 ${r.dataset.cases}`,
    `- 目標を満たしたか: ${m.meetsTargets ? "満たした" : "満たしていない"}`,
    "",
    "## 件数",
    "",
    `対照 ${m.counts.controls} 件、欠陥のある例 ${m.counts.faulty} 件。評価が済んだ ${m.counts.finished} 件、途中 ${m.counts.pending} 件、止めた ${m.counts.stopped} 件(出力の形が違い、上限に達した)。`,
    "",
    "## 指標",
    "",
    "| 指標 | 分子 | 分母 | 割合 |",
    "| --- | ---: | ---: | ---: |",
    row("検出率(全体)", m.detectionOverall),
    ...DEFECT_KINDS.map((k) => row(`検出率(${DEFECT_LABEL[k]})`, m.detectionByKind[k])),
    row("見落とし率", m.missRate),
    row("誤検出率", m.falsePositive),
    row("理由コードの一致率(目標なし)", m.codeMatch),
    "",
    "## 目標",
    "",
    `- 検出率(全体)は ${(r.targets.detectionOverall * 100).toFixed(0)}% 以上、種類ごとは ${(r.targets.detectionPerKind * 100).toFixed(0)}% 以上、誤検出率は ${(r.targets.falsePositiveMax * 100).toFixed(0)}% 以下。`,
    `- 下回った項目: ${m.belowTarget.length === 0 ? "なし" : m.belowTarget.join("、")}`,
    `- 測れなかった項目: ${m.unmeasured.length === 0 ? "なし" : m.unmeasured.join("、")}`,
    "",
  ].join("\n")}\n`;
}
