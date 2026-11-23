import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import { BodyCache } from "../collect/cache.ts";
import type { Config } from "../config.ts";
import { DecisionsError, decisionsPath, draftDecision, readDecisions } from "../decisions/decisions.ts";
import { DraftsError, draftWorkDir, readDrafts } from "../draft/store.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { FactsError, type FactsFile, factsPath, readFacts } from "../facts/schema.ts";
import { type Output, report } from "../log.ts";
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
import { buildVerifyRequest, checkExplanationOutput, checkRederiveOutput } from "../verify/check.ts";
import {
  collectSections,
  ExplanationOutputSchema,
  evidenceHash,
  RederiveOutputSchema,
  VerifyRequestSchema,
  verifyKey,
} from "../verify/request.ts";
import {
  buildDataset,
  datasetHash,
  ERROR_KIND_LABEL,
  ERROR_KINDS,
  type EvalCase,
  EvalDataError,
  type EvalDataset,
  parseDataset,
} from "./dataset.ts";
import { type CaseResult, CaseResultSchema, computeMetrics, type Metrics, verdictOf } from "./metrics.ts";

/**
 * eval コマンド: 検証役(question-verifier)の見落としと誤検出を数字で測る(ADR 0009)。
 * - eval <資格コード>            評価用のデータ(なければ作る)から、検証の依頼を作業用の置き場に書く
 * - eval <資格コード> --import   検証役の出力を、期待する判定と照合して取り込み、レポートを書く
 * モデルも API キーも使わない。評価用のデータは、人が承認した下書きから作る。`data/` は変えない。
 * 依頼は検証と同じ形(再導出 → 解説の確認)で、並列の実行はパイプラインを回すスキルが行う。
 */

export type EvalMode = "request" | "import";

export interface EvalOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  mode: EvalMode;
  dryRun: boolean;
  output: Output;
  /** 今日の日付(YYYY-MM-DD)。レポートに載せる */
  today(): string;
}

export interface Paths {
  facts: string;
  drafts: string;
  decisions: string;
  cacheDir: string;
  dir: string;
  dataset: string;
  results: string;
  state: string;
  requestsDir: string;
  outDir: string;
  reportJson: string;
  reportMd: string;
}

export function pathsFor(config: Config, rootDir: string, examCode: string): Paths {
  const work = resolve(rootDir, config.workDir);
  const dir = join(work, "eval", examCode.toLowerCase());
  return {
    facts: factsPath(resolve(rootDir, config.factsDir), examCode),
    drafts: join(draftWorkDir(work, examCode), "drafts.json"),
    decisions: decisionsPath(resolve(rootDir, config.decisionsDir), examCode),
    cacheDir: join(work, "cache"),
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

const ResultsFileSchema = z.record(z.string(), CaseResultSchema);

export function readResults(path: string): Record<string, CaseResult> {
  const raw = existsSync(path) ? readJsonFile(path) : undefined;
  const parsed = ResultsFileSchema.safeParse(raw);
  return parsed.success ? parsed.data : {};
}

function readAttempts(path: string): Record<string, number> {
  const raw = existsSync(path) ? readJsonFile(path) : undefined;
  if (raw === null || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number")) as Record<string, number>;
}

export function runEval(options: EvalOptions): ExitCode {
  const { config, rootDir, examCode, output } = options;
  const exam = prepareExam(options);
  if (!exam.ok) return exam.exit;
  const stamp = readAgentStampOrReport(output, rootDir, "question-verifier");
  if (stamp === null) return EXIT.checkFailed;
  const paths = pathsFor(config, rootDir, examCode);
  let facts: FactsFile;
  let dataset: EvalDataset | null = null;
  try {
    facts = readFacts(paths.facts, examCode);
    if (existsSync(paths.dataset)) dataset = parseDataset(readJsonFile(paths.dataset));
  } catch (error) {
    if (error instanceof FactsError) for (const p of error.paths) report(output, "事実カードの誤り", p);
    else if (error instanceof EvalDataError) for (const p of error.paths) report(output, "評価用データの誤り", p);
    else throw error;
    return EXIT.checkFailed;
  }
  const cache = new BodyCache(paths.cacheDir, config.cache, Date.now);
  if (dataset === null) {
    const made = createDataset(options, paths, facts, cache);
    if (typeof made === "number") return made;
    dataset = made;
  }
  const ctx = { options, paths, facts, cache, dataset, stamp };
  return options.mode === "request" ? requestStep(ctx) : importStep(ctx);
}

interface Context {
  options: EvalOptions;
  paths: Paths;
  facts: FactsFile;
  cache: BodyCache;
  dataset: EvalDataset;
  stamp: AgentStamp;
}

/** 人が承認した選択式の下書きから、評価用のデータを作って書く。種を記録し、同じ入力と種から同じデータができる */
function createDataset(options: EvalOptions, paths: Paths, facts: FactsFile, cache: BodyCache): EvalDataset | ExitCode {
  const { config, examCode, output, dryRun } = options;
  let bases: {
    id: string;
    draft: Extract<NonNullable<ReturnType<typeof readDrafts>["drafts"][number]["draft"]>, { choices: unknown }>;
  }[];
  try {
    const drafts = readDrafts(paths.drafts, examCode);
    const decisions = readDecisions(paths.decisions, examCode);
    bases = drafts.drafts.flatMap((d) => {
      const draft = d.draft;
      if (draft === null || !("choices" in draft) || draftDecision(decisions, d.id) !== "approve") return [];
      // 根拠の節を取り出せない下書きは、評価に使えない
      return collectSections(draft, facts, cache).ok ? [{ id: d.id, draft }] : [];
    });
  } catch (error) {
    if (error instanceof DraftsError) for (const p of error.paths) report(output, "下書きの誤り", p);
    else if (error instanceof DecisionsError) for (const p of error.paths) report(output, "判断の記録の誤り", p);
    else throw error;
    return EXIT.checkFailed;
  }
  if (bases.length === 0) {
    report(output, "入力の誤り", "人が承認した選択式の下書きがない(評価用のデータを作れない)");
    return EXIT.inputError;
  }
  const { dataset, skipped } = buildDataset(examCode, bases, { seed: config.eval.seed, perKind: config.eval.perKind });
  for (const kind of ERROR_KINDS) {
    if (skipped[kind] > 0) report(output, "情報", `評価用のデータ: ${kind} は ${skipped[kind]} 件を作れなかった`);
  }
  report(
    output,
    "情報",
    `評価用のデータ: 対照 ${dataset.cases.filter((c) => c.kind === "control").length} 件、誤りのある例 ${dataset.cases.filter((c) => c.kind !== "control").length} 件(種 ${dataset.seed}、元の下書き ${bases.length} 件)`,
  );
  if (!dryRun) writeJson(paths.dataset, dataset);
  return dataset;
}

function sectionsFor(ctx: Context, c: EvalCase) {
  return collectSections(c.draft, ctx.facts, ctx.cache);
}

function requestStep(ctx: Context): ExitCode {
  const { options, paths, stamp, dataset } = ctx;
  const { config, rootDir, examCode, output, dryRun } = options;
  const results = readResults(paths.results);
  let requested = 0;
  let pending = 0;
  let finished = 0;
  let exhausted = 0;
  let missingSection = 0;
  let limited = false;
  for (const c of dataset.cases) {
    const verdict = verdictOf(results[c.caseId]);
    if (verdict === "pass" || verdict === "hold") {
      finished++;
      continue;
    }
    if (verdict === "stopped") {
      exhausted++;
      continue;
    }
    const check = results[c.caseId]?.rederive === "pass" ? "explanation" : "rederive";
    const found = sectionsFor(ctx, c);
    if (!found.ok) {
      report(output, "評価の節なし", `${c.caseId} ${found.reason}`);
      missingSection++;
      continue;
    }
    const evidence = evidenceHash(found.sections, c.draft);
    const key = verifyKey(check, c.caseId, evidence, stamp.definitionHash);
    const requestPath = join(paths.requestsDir, `${key}.json`);
    if (existsSync(requestPath)) {
      pending++;
      continue;
    }
    if (requested >= config.maxItemsPerRun) {
      limited = true;
      break;
    }
    const request = buildVerifyRequest({
      check,
      examCode,
      key,
      draftId: c.caseId,
      draft: c.draft,
      sections: found.sections,
      evidence,
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
  // 止めたもの(出力の形が違い、上限に達した)は、先へ進めないので、検査の失敗として止める
  return limited || missingSection > 0 || exhausted > 0 ? EXIT.checkFailed : EXIT.ok;
}

function importStep(ctx: Context): ExitCode {
  const { options, paths, stamp, dataset } = ctx;
  const { config, output, dryRun } = options;
  const flow: FlowContext = { output, stopLabel: "評価の取り込みの停止", dryRun };
  const attempts = readAttempts(paths.state);
  const results = readResults(paths.results);
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
    const parsedRequest = VerifyRequestSchema.safeParse(readJsonFile(requestPath));
    if (!parsedRequest.success || parsedRequest.data.requestKey !== key) {
      reportStop(flow, key, "request-invalid");
      failures++;
      continue;
    }
    const request = parsedRequest.data;
    const c = dataset.cases.find((x) => x.caseId === request.draftId);
    const found = c ? sectionsFor(ctx, c) : null;
    // 依頼のあとに、定義・データ・根拠の節が変わった。出力の形を見る前に、依頼を作り直す
    const stale =
      definitionChanged(request, stamp) ||
      c === undefined ||
      found === null ||
      !found.ok ||
      evidenceHash(found.sections, c.draft) !== request.evidenceHash ||
      verdictOf(results[c.caseId]) !== "pending" ||
      (request.check === "explanation") !== (results[c.caseId]?.rederive === "pass");
    if (stale) {
      discardStale(flow, key, requestPath, outPath);
      continue;
    }
    const fail = (reason: string) => {
      failOutput(flow, key, reason, outPath, attempts);
      failures++;
      // 上限に達したものは、先へ進めないので、止めたものとして数える
      if (!dryRun && (attempts[key] ?? 0) >= config.eval.maxAttempts) {
        results[c.caseId] = { ...results[c.caseId], stopped: true };
      }
    };
    const raw = readJsonFile(outPath);
    if (request.check === "rederive") {
      const parsed = RederiveOutputSchema.safeParse(raw);
      if (!parsed.success) {
        fail("output-invalid");
        continue;
      }
      const checked = checkRederiveOutput(request, parsed.data, c.draft.correctAnswers);
      if (!checked.ok) {
        fail(checked.reason);
        continue;
      }
      results[c.caseId] = {
        ...results[c.caseId],
        rederive: checked.codes.length === 0 ? "pass" : "hold",
        choices: Object.fromEntries(checked.choices.map((x) => [x.key, x.judgement])),
      };
    } else {
      const parsed = ExplanationOutputSchema.safeParse(raw);
      if (!parsed.success) {
        fail("output-invalid");
        continue;
      }
      const checked = checkExplanationOutput(request, parsed.data);
      if (!checked.ok) {
        fail(checked.reason);
        continue;
      }
      results[c.caseId] = {
        ...results[c.caseId],
        explanation: checked.findings.length === 0 ? "pass" : "hold",
        findings: checked.findings.map((f) => `${f.where} ${f.code}`),
      };
    }
    doneFiles.push(file);
  }

  const metrics = computeMetrics(dataset.cases, results, config.eval.targets);
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
  writeJson(paths.results, results);
  writeJson(paths.state, attempts);
  cleanupImported(doneFiles, paths.requestsDir, paths.outDir);
  const reportBody = buildReport(ctx, metrics);
  writeJson(paths.reportJson, reportBody);
  writeFileAtomic(paths.reportMd, renderReport(reportBody));
  report(output, "レビューレポート", relative(options.rootDir, paths.reportMd));
  report(output, "レビューレポート", relative(options.rootDir, paths.reportJson));
  return failures > 0 ? EXIT.checkFailed : EXIT.ok;
}

const pct = (r: { rate: number | null }) => (r.rate === null ? "-" : `${(r.rate * 100).toFixed(1)}%`);

function reportMetrics(output: Output, m: Metrics): void {
  report(
    output,
    "評価の指標",
    `検出率(全体) ${pct(m.detectionOverall)} ${m.detectionOverall.numerator}/${m.detectionOverall.denominator}`,
  );
  for (const kind of ERROR_KINDS) {
    const r = m.detectionByKind[kind];
    report(output, "評価の指標", `検出率(${kind}) ${pct(r)} ${r.numerator}/${r.denominator}`);
  }
  report(output, "評価の指標", `見落とし率 ${pct(m.missRate)} ${m.missRate.numerator}/${m.missRate.denominator}`);
  report(
    output,
    "評価の指標",
    `誤検出率 ${pct(m.falsePositive)} ${m.falsePositive.numerator}/${m.falsePositive.denominator}`,
  );
  report(output, "評価の指標", `不採用率(再導出) ${pct(m.rejectionByStage.rederive)}`);
  report(output, "評価の指標", `不採用率(解説の確認) ${pct(m.rejectionByStage.explanation)}`);
  report(output, "評価の指標", `目標 ${m.meetsTargets ? "満たした" : "満たしていない"}`);
}

/** レポート。どの検証役の定義・モデル・評価用のデータで測ったかが分かる。件数・ID・種類だけを持ち、本文は含まない */
export function buildReport(ctx: Context, metrics: Metrics) {
  const { options, dataset, stamp } = ctx;
  return {
    examCode: options.examCode,
    date: options.today(),
    agent: stamp,
    dataset: {
      hash: datasetHash(dataset),
      seed: dataset.seed,
      perKind: dataset.perKind,
      cases: dataset.cases.length,
      caseIds: dataset.cases.map((c) => ({ caseId: c.caseId, baseDraftId: c.baseDraftId, kind: c.kind })),
    },
    targets: options.config.eval.targets,
    metrics,
  };
}

export type EvalReport = ReturnType<typeof buildReport>;

export function renderReport(r: EvalReport): string {
  const m = r.metrics;
  const row = (label: string, x: { numerator: number; denominator: number; rate: number | null }) =>
    `| ${label} | ${x.numerator} | ${x.denominator} | ${pct(x)} |`;
  return `${[
    `# 検証役の評価(${r.examCode})`,
    "",
    `- 実行日: ${r.date}`,
    `- 検証役: ${r.agent.role}(モデル ${r.agent.model}、定義のハッシュ ${r.agent.definitionHash})`,
    `- 評価用のデータ: ハッシュ ${r.dataset.hash}、種 ${r.dataset.seed}、件数 ${r.dataset.cases}`,
    `- 目標を満たしたか: ${m.meetsTargets ? "満たした" : "満たしていない"}`,
    "",
    "## 件数",
    "",
    `対照 ${m.counts.controls} 件、誤りのある例 ${m.counts.faulty} 件。評価が済んだ ${m.counts.finished} 件、途中 ${m.counts.pending} 件、止めた ${m.counts.stopped} 件(出力の形が違い、上限に達した)。`,
    "",
    "## 指標",
    "",
    "| 指標 | 分子 | 分母 | 割合 |",
    "| --- | ---: | ---: | ---: |",
    row("検出率(全体)", m.detectionOverall),
    ...ERROR_KINDS.map((k) => row(`検出率(${ERROR_KIND_LABEL[k]})`, m.detectionByKind[k])),
    row("見落とし率", m.missRate),
    row("誤検出率", m.falsePositive),
    row("不採用率(再導出)", m.rejectionByStage.rederive),
    row("不採用率(解説の確認)", m.rejectionByStage.explanation),
    "",
    "## 目標",
    "",
    `- 検出率(全体)は ${(r.targets.detectionOverall * 100).toFixed(0)}% 以上、種類ごとは ${(r.targets.detectionPerKind * 100).toFixed(0)}% 以上、誤検出率は ${(r.targets.falsePositiveMax * 100).toFixed(0)}% 以下。`,
    `- 下回った項目: ${m.belowTarget.length === 0 ? "なし" : m.belowTarget.join("、")}`,
    `- 測れなかった項目: ${m.unmeasured.length === 0 ? "なし" : m.unmeasured.join("、")}`,
    "",
  ].join("\n")}\n`;
}
