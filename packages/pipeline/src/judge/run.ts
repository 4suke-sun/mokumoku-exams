import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Config } from "../config.ts";
import { QuestionsFileSchema } from "../contract.ts";
import { DecisionsError, decisionsPath, draftDecision, readDecisions } from "../decisions/decisions.ts";
import { isChoiceDraft } from "../draft/schema.ts";
import { DraftsError, draftWorkDir, readDrafts } from "../draft/store.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { type Output, report } from "../log.ts";
import { resolveProfile } from "../scorecard/profiles.ts";
import { questionPasses, scoreQuestion } from "../scorecard/score.ts";
import { type AgentStamp, readAgentStampOrReport } from "../shared/agents.ts";
import { prepareExam } from "../shared/exam.ts";
import { writeJson } from "../shared/fs.ts";
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
import { isVerified } from "../verify/schema.ts";
import { checkJudgeOutput } from "./check.ts";
import { type Criteria, readCriteriaWithScope } from "./criteria.ts";
import { contentHash, inputFromDraft, inputFromQuestion, type JudgeInput, toScoreInput } from "./input.ts";
import { buildJudgeRequest, JudgeRequestSchema, judgeKey } from "./request.ts";
import {
  JUDGE_VERDICTS,
  type JudgeEntry,
  JudgeOutputSchema,
  type JudgeResults,
  JudgeResultsSchema,
  reasonsOf,
} from "./schema.ts";

/**
 * judge コマンド: 公開している選択式の問題を、判定役が、資格別の判定の基準(LLM の観点)に照らして判定する(ADR 0021)。
 * - judge <資格コード>            判定の依頼を作業用の置き場に書く(同じ入力は依頼しない)
 * - judge <資格コード> --import   判定役の出力を、依頼と照合して取り込み、判定の結果を書く
 * モデルは呼ばない。判定はエージェント(question-judge)が行う。`data/` は変えない(非公開へ移すのは別の作業)。
 * 判定の結果は、問題の ID・判定・理由コード・指摘の場所・機械の観点の点数と減点の項目・各種ハッシュだけを持ち、本文は含まない。
 */

export type JudgeMode = "request" | "import";

export interface JudgeOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  mode: JudgeMode;
  dryRun: boolean;
  output: Output;
}

interface Paths {
  questions: string;
  dir: string;
  requestsDir: string;
  outDir: string;
  results: string;
  state: string;
}

function pathsFor(config: Config, rootDir: string, examCode: string): Paths {
  const dir = join(resolve(rootDir, config.workDir), "judge", examCode.toLowerCase());
  return {
    questions: resolve(rootDir, dirname(config.examsFile), `questions.${examCode.toLowerCase()}.json`),
    dir,
    requestsDir: join(dir, "requests"),
    outDir: join(dir, "out"),
    results: join(dir, "results.json"),
    state: join(dir, "state.json"),
  };
}

function readAttempts(path: string): Record<string, number> {
  const raw = existsSync(path) ? readJsonFile(path) : undefined;
  if (raw === null || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number")) as Record<string, number>;
}

/** 判定の結果を読む。なければ空。読めなければ null */
export function readJudgeResults(path: string, examCode: string): JudgeResults | null {
  if (!existsSync(path)) return { examCode, entries: [] };
  const parsed = JudgeResultsSchema.safeParse(readJsonFile(path));
  return parsed.success && parsed.data.examCode === examCode ? parsed.data : null;
}

/** 公開している選択式の問題。自由記述は判定しない(点数票と同じ) */
function loadInputs(file: string): JudgeInput[] | null {
  const parsed = QuestionsFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
  if (!parsed.success) return null;
  return parsed.data.questions
    .flatMap((q) => inputFromQuestion(q) ?? [])
    .sort((a, b) => (a.questionId < b.questionId ? -1 : 1));
}

/**
 * 書き直した問題の下書き(非公開の問題の書き直し。ADR 0023)。検証を通った選択式の下書きを、元の問題の ID で判定に出す。
 * 判定の結果は、公開への復帰(restore)が、問題の ID・本文のハッシュ・判定の基準・判定役の定義で照合する。
 * 読めないときは null
 */
function loadRewriteInputs(config: Config, rootDir: string, examCode: string, output: Output): JudgeInput[] | null {
  try {
    const work = resolve(rootDir, config.workDir);
    const drafts = readDrafts(join(draftWorkDir(work, examCode), "drafts.json"), examCode);
    const decisions = readDecisions(decisionsPath(resolve(rootDir, config.decisionsDir), examCode), examCode);
    const inputs: JudgeInput[] = [];
    for (const d of drafts.drafts) {
      if (d.rewriteOf === undefined || d.status !== "passed" || d.draft === null || !isChoiceDraft(d.draft)) continue;
      if (!isVerified(d.verification, draftDecision(decisions, d.id))) continue;
      if (inputs.some((i) => i.questionId === d.rewriteOf)) continue;
      inputs.push(inputFromDraft(d.rewriteOf, d.draft));
    }
    return inputs;
  } catch (error) {
    if (error instanceof DraftsError) for (const p of error.paths) report(output, "下書きの誤り", p);
    else if (error instanceof DecisionsError) for (const p of error.paths) report(output, "判断の記録の誤り", p);
    else throw error;
    return null;
  }
}

interface Context {
  options: JudgeOptions;
  paths: Paths;
  inputs: JudgeInput[];
  criteria: Criteria;
  stamp: AgentStamp;
  profile: NonNullable<ReturnType<typeof resolveProfile>>;
}

export function runJudge(options: JudgeOptions): ExitCode {
  const { config, rootDir, examCode, output } = options;
  const exam = prepareExam(options);
  if (!exam.ok) return exam.exit;
  const profile = resolveProfile(examCode);
  if (profile === null) {
    report(output, "入力の誤り", "点数票の帯がない資格");
    return EXIT.inputError;
  }
  const paths = pathsFor(config, rootDir, examCode);
  if (!existsSync(paths.questions)) {
    report(output, "入力の誤り", "問題データがない");
    return EXIT.inputError;
  }
  const published = loadInputs(paths.questions);
  if (published === null) {
    report(output, "問題データの誤り", relative(rootDir, paths.questions));
    return EXIT.inputError;
  }
  const rewrites = loadRewriteInputs(config, rootDir, examCode, output);
  if (rewrites === null) return EXIT.checkFailed;
  // 公開の問題と、書き直した問題(まだ非公開の問題の ID)を合わせて判定する。公開の問題と ID が重なる書き直しは出さない
  const inputs = [...published, ...rewrites.filter((r) => !published.some((p) => p.questionId === r.questionId))].sort(
    (a, b) => (a.questionId < b.questionId ? -1 : 1),
  );
  if (inputs.length === 0) {
    report(output, "入力の誤り", "選択式の問題がない");
    return EXIT.inputError;
  }
  const criteria = readCriteriaWithScope(config, rootDir, examCode, output);
  if (criteria === undefined) return EXIT.checkFailed;
  if (criteria === null) {
    report(output, "入力の誤り", "判定の基準がない(資格別の文書に「判定の基準」の節がない)");
    return EXIT.inputError;
  }
  const stamp = readAgentStampOrReport(output, rootDir, "question-judge");
  if (stamp === null) return EXIT.checkFailed;
  const ctx: Context = { options, paths, inputs, criteria, stamp, profile };
  return options.mode === "request" ? requestStep(ctx) : importStep(ctx);
}

const machineOf = (input: JudgeInput, profile: Context["profile"]) => {
  const score = scoreQuestion(toScoreInput(input), profile);
  return { total: score.total, lost: score.lost as string[], candidate: !questionPasses(score) };
};

/** その問題の判定が、いまの内容・基準・判定役の定義で済んでいるか */
function isCurrent(entry: JudgeEntry | undefined, input: JudgeInput, criteria: Criteria, stamp: AgentStamp): boolean {
  return (
    entry !== undefined &&
    entry.contentHash === contentHash(input) &&
    entry.criteriaHash === criteria.hash &&
    entry.agent.definitionHash === stamp.definitionHash
  );
}

function requestStep(ctx: Context): ExitCode {
  const { options, paths, inputs, criteria, stamp, profile } = ctx;
  const { config, rootDir, examCode, output, dryRun } = options;
  const results = readJudgeResults(paths.results, examCode);
  if (results === null) {
    report(output, "入力の誤り", "判定の結果が読めない");
    return EXIT.checkFailed;
  }
  const attempts = readAttempts(paths.state);
  let requested = 0;
  let current = 0;
  let pending = 0;
  let exhausted = 0;
  let limited = false;
  for (const input of inputs) {
    const entry = results.entries.find((e) => e.questionId === input.questionId);
    if (isCurrent(entry, input, criteria, stamp)) {
      current++;
      continue;
    }
    const key = judgeKey(input, criteria, stamp.definitionHash);
    if ((attempts[key] ?? 0) >= config.judge.maxAttempts) {
      report(output, "再試行の上限", `${input.questionId} max-attempts`);
      exhausted++;
      continue;
    }
    const requestPath = join(paths.requestsDir, `${key}.json`);
    if (existsSync(requestPath)) {
      pending++;
      continue;
    }
    if (requested >= config.maxItemsPerRun) {
      limited = true;
      break;
    }
    const request = buildJudgeRequest({
      examCode,
      key,
      input,
      criteria,
      machine: machineOf(input, profile),
      outputPath: relative(rootDir, join(paths.outDir, `${key}.json`)),
      stamp,
    });
    if (!dryRun) writeJson(requestPath, request);
    report(output, "判定の依頼", relative(rootDir, requestPath));
    requested++;
  }
  report(output, "情報", `依頼 ${requested} 件、依頼済みで待っている ${pending} 件、判定済みで飛ばした ${current} 件`);
  if (dryRun) report(output, "書き込みをしない(dry-run)");
  if (limited) report(output, "件数の上限", "maxItemsPerRun(再実行で続きから進む)");
  return limited || exhausted > 0 ? EXIT.checkFailed : EXIT.ok;
}

function importStep(ctx: Context): ExitCode {
  const { options, paths, inputs, criteria, stamp } = ctx;
  const { examCode, output, dryRun } = options;
  const flow: FlowContext = { output, stopLabel: "判定の取り込みの停止", dryRun };
  const results = readJudgeResults(paths.results, examCode);
  if (results === null) {
    report(output, "入力の誤り", "判定の結果が読めない");
    return EXIT.checkFailed;
  }
  const attempts = readAttempts(paths.state);
  let entries = results.entries;
  const doneFiles: string[] = [];
  let failures = 0;

  for (const file of listRequestFiles(paths.requestsDir)) {
    const key = file.replace(/\.json$/, "");
    const outPath = join(paths.outDir, file);
    if (!existsSync(outPath)) {
      report(output, "判定の出力なし", key);
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
    const input = inputs.find((i) => i.questionId === request.questionId);
    // 依頼のあとに、定義・問題の内容・判定の基準が変わった。出力の形を見る前に、依頼を作り直す
    const stale =
      definitionChanged(request, stamp) ||
      input === undefined ||
      contentHash(input) !== request.contentHash ||
      criteria.hash !== request.criteriaHash ||
      isCurrent(
        entries.find((e) => e.questionId === request.questionId),
        input,
        criteria,
        stamp,
      );
    if (stale) {
      discardStale(flow, key, requestPath, outPath);
      continue;
    }
    const fail = (reason: string) => {
      failOutput(flow, key, reason, outPath, attempts);
      failures++;
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
    const entry: JudgeEntry = {
      questionId: request.questionId,
      contentHash: request.contentHash,
      criteriaHash: request.criteriaHash,
      verdict: parsed.data.verdict,
      reasons: reasonsOf(parsed.data.findings),
      findings: parsed.data.findings,
      machine: { total: request.machine.total, lost: request.machine.lost, candidate: request.machine.candidate },
      agent: stamp,
    };
    entries = [...entries.filter((e) => e.questionId !== entry.questionId), entry];
    doneFiles.push(file);
  }

  // 判定に出す問題(公開の問題と、書き直した問題)にない ID の結果は残さない(問題が削除・非公開になった)。並びは ID の順
  const known = new Set(inputs.map((i) => i.questionId));
  entries = entries.filter((e) => known.has(e.questionId)).sort((a, b) => (a.questionId < b.questionId ? -1 : 1));
  reportSummary(output, entries, inputs, criteria, stamp);
  report(output, "情報", `取り込み: ${doneFiles.length} 件、停止 ${failures} 件`);
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return failures > 0 ? EXIT.checkFailed : EXIT.ok;
  }
  if (doneFiles.length > 0 || entries.length !== results.entries.length) {
    writeJson(paths.results, { examCode, entries } satisfies JudgeResults);
  }
  writeJson(paths.state, attempts);
  cleanupImported(doneFiles, paths.requestsDir, paths.outDir);
  return failures > 0 ? EXIT.checkFailed : EXIT.ok;
}

/** 判定の結果の要約。件数・理由コード・ID だけで、本文は出さない */
function reportSummary(
  output: Output,
  entries: readonly JudgeEntry[],
  inputs: readonly JudgeInput[],
  criteria: Criteria,
  stamp: AgentStamp,
): void {
  const current = entries.filter((e) => {
    const input = inputs.find((i) => i.questionId === e.questionId);
    return input !== undefined && isCurrent(e, input, criteria, stamp);
  });
  const counts = Object.fromEntries(JUDGE_VERDICTS.map((v) => [v, current.filter((e) => e.verdict === v).length]));
  report(
    output,
    "判定の結果",
    `選択式 ${inputs.length} 問のうち判定済み ${current.length} 問: ${JUDGE_VERDICTS.map((v) => `${v} ${counts[v]}`).join("、")}`,
  );
  const byReason = new Map<string, number>();
  for (const e of current) for (const r of e.reasons) byReason.set(r, (byReason.get(r) ?? 0) + 1);
  const reasonLine = [...byReason].sort(([a], [b]) => (a < b ? -1 : 1)).map(([r, n]) => `${r}=${n}`);
  report(output, "判定の結果", `理由コード(問数): ${reasonLine.length === 0 ? "なし" : reasonLine.join(" ")}`);
  const candidates = current.filter((e) => e.machine.candidate);
  const candidatePublish = candidates.filter((e) => e.verdict === "publish");
  report(
    output,
    "判定の結果",
    `機械の観点で不合格(候補)の問題 ${candidates.length} 問のうち、判定が publish のもの ${candidatePublish.length} 問`,
  );
}
