import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { BodyCache } from "../collect/cache.ts";
import { LedgerError, type LedgerFile, ledgerPath, readLedger } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import { checkAnswerBias } from "../contract.ts";
import {
  DecisionsError,
  type DecisionsFile,
  decisionsPath,
  draftDecision,
  orphanDecisions,
  readDecisions,
  upsertDecisions,
  writeDecisions,
} from "../decisions/decisions.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { criteriaAccepted } from "../export/criteria.ts";
import { type FactCard, FactsError, type FactsFile, factsPath, readFacts } from "../facts/schema.ts";
import { contentHash, inputFromQuestion } from "../judge/input.ts";
import { type Output, report } from "../log.ts";
import { readExistingTexts } from "../plan/run.ts";
import { PlanError, type PlanFile, planPath, readPlan } from "../plan/schema.ts";
import { servicePriority, serviceStatus } from "../plan/services.ts";
import { planFor, recordedOrComputed } from "../sampling/load.ts";
import type { SamplingPlan } from "../sampling/plan.ts";
import { recordOf, writeSampling } from "../sampling/store.ts";
import { scorecardWarnings } from "../scorecard/draft.ts";
import { vendorOf } from "../scorecard/profiles.ts";
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
  reportStop,
} from "../shared/request-flow.ts";
import { scopeFindings, scopeListsOf } from "../shared/scope.ts";
import { readTerms, type Terms, TermsError } from "../shared/terms.ts";
import { copyCheck } from "./copy.ts";
import { candidateOf, findDuplicates, maxSimilarity, readPublishedCandidates, readPublishedChoices } from "./dedupe.ts";
import { checkDistractors } from "./distractors.ts";
import { requestStyleGuides } from "./guides.ts";
import {
  buildEntry,
  checkProvenance,
  checkRecheck,
  type ProvenanceEntry,
  ProvenanceError,
  type ProvenanceFile,
  provenancePath,
  readProvenance,
  unprovenanced,
  usableFact,
  writeProvenance,
} from "./provenance.ts";
import {
  assignAnswerPositions,
  type DraftRequest,
  DraftRequestSchema,
  DraftsOutputSchema,
  factSource,
  positionKey,
  requestKey,
  selectFacts,
  styleRuleSummaries,
} from "./request.ts";
import {
  buildReviewSheet,
  decisionsFromSheet,
  NO_SKIP,
  type ReviewSheet,
  ReviewSheetSchema,
  type ReviewSkip,
  renderDraftReview,
  reviewCounts,
} from "./review.ts";
import { evidenceLocations, reviseFacts, reviseTargets } from "./revise.ts";
import {
  identityOf,
  readUnpublished,
  rewritePlanItemId,
  rewriteTargets,
  sameContentProblems,
  topicsOf,
} from "./rewrite.ts";
import { assembleQuestion, DISTRACTOR_TYPES, draftId, isChoiceDraft, schemaProblems } from "./schema.ts";
import {
  applyDraftDecisions,
  type DraftRecord,
  DraftsError,
  type DraftsFile,
  draftWorkDir,
  HUMAN_REJECTED,
  REVISED,
  readDrafts,
  readState,
  type UnmetReason,
  usedFactIds,
  writeDrafts,
  writeState,
} from "./store.ts";
import { evaluateStyle, STYLE_VERSION } from "./style.ts";

/**
 * draft コマンド: 出題計画と事実カードから、選択式の問題の下書きを作る。
 * - draft <資格コード>            計画の項目ごとに、下書きの依頼を作業用の置き場に書く(同じ入力は依頼しない)
 * - draft <資格コード> --import   エージェントの出力を検査して取り込む(形、スタイル規則、根拠の事実カード、来歴)
 * - draft <資格コード> --check    下書きの来歴を検査する(来歴のない下書きは、検証の段階へ進めない)
 * - draft <資格コード> --revise   保留の選択式の下書きごとに、直しの依頼を書く(取り込みは --import)
 * - draft <資格コード> --rewrite  非公開の問題(判定が「書き直しで復帰できる」)ごとに、書き直しの依頼を書く(取り込みは --import。ADR 0023)
 * モデルは呼ばない。下書きはエージェント(question-drafter)が書き、直しはエージェント(question-reviser)が書く(ADR 0009・0019)。data/ は変えない。
 */

export type DraftMode = "request" | "revise" | "rewrite" | "import" | "check" | "review" | "decide";

export interface DraftOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  mode: DraftMode;
  dryRun: boolean;
  output: Output;
  /** 依頼を書く分野を 1 つに絞る(資格マスタの分野のコード)。省略すると全分野 */
  domain?: string;
}

interface Paths {
  plan: string;
  facts: string;
  ledger: string;
  provenance: string;
  requestsDir: string;
  outDir: string;
  drafts: string;
  state: string;
  decisions: string;
  reviewMd: string;
  reviewSheet: string;
}

function pathsFor(config: Config, rootDir: string, examCode: string): Paths {
  const work = resolve(rootDir, config.workDir);
  const dir = draftWorkDir(work, examCode);
  return {
    plan: planPath(work, examCode),
    facts: factsPath(resolve(rootDir, config.factsDir), examCode),
    ledger: ledgerPath(resolve(rootDir, config.ledgerDir), examCode),
    provenance: provenancePath(resolve(rootDir, config.provenanceDir), examCode),
    requestsDir: join(dir, "requests"),
    outDir: join(dir, "out"),
    drafts: join(dir, "drafts.json"),
    state: join(dir, "state.json"),
    decisions: decisionsPath(resolve(rootDir, config.decisionsDir), examCode),
    reviewMd: join(dir, "review.md"),
    reviewSheet: join(dir, "review-sheet.json"),
  };
}

export function runDraft(options: DraftOptions): ExitCode {
  const { config, rootDir, examCode, output } = options;
  const exam = prepareExam(options, { production: true });
  if (!exam.ok) return exam.exit;
  const master = exam.master;
  // 入力した文字列は出さない
  if (options.domain !== undefined && !master.domains.some((d) => d.code === options.domain)) {
    report(output, "入力の誤り", "資格マスタにない分野");
    return EXIT.inputError;
  }
  const paths = pathsFor(config, rootDir, examCode);
  let facts: FactsFile;
  let drafts: DraftsFile;
  let ledger: LedgerFile;
  let provenance: ProvenanceFile;
  let decisions: DecisionsFile;
  try {
    decisions = readDecisions(paths.decisions, examCode);
    facts = readFacts(paths.facts, examCode);
    drafts = readDrafts(paths.drafts, examCode);
    ledger = readLedger(paths.ledger, examCode);
    provenance = readProvenance(paths.provenance, examCode);
  } catch (error) {
    if (error instanceof FactsError) for (const p of error.paths) report(output, "事実カードの誤り", p);
    else if (error instanceof DraftsError) for (const p of error.paths) report(output, "下書きの誤り", p);
    else if (error instanceof LedgerError) for (const p of error.paths) report(output, "台帳の誤り", p);
    else if (error instanceof ProvenanceError) for (const p of error.paths) report(output, "来歴の誤り", p);
    else if (error instanceof DecisionsError) for (const p of error.paths) report(output, "判断の記録の誤り", p);
    else throw error;
    return EXIT.checkFailed;
  }
  // 人の判断(保留の解除・承認・却下)を、下書きの状態に反映する。対象がなくなった判断は、黙って捨てずに報告する
  const decided = applyDraftDecisions(drafts, (id) => draftDecision(decisions, id));
  if (decided.changed > 0) {
    report(output, "判断の反映", `下書き ${decided.changed} 件`);
    drafts = decided.file;
    if (!options.dryRun) writeDrafts(paths.drafts, drafts);
  }
  for (const d of orphanDecisions(decisions, { draftIds: drafts.drafts.map((x) => x.id) })) {
    if (d.target === "draft") report(output, "判断の対象なし", `draft ${d.id}`);
  }
  const needsDrafter = options.mode === "request" || options.mode === "import";
  const needsReviser = options.mode === "revise" || options.mode === "rewrite" || options.mode === "import";
  const stamp = needsDrafter ? readAgentStampOrReport(output, rootDir, "question-drafter") : null;
  if (needsDrafter && stamp === null) return EXIT.checkFailed;
  const reviser = needsReviser ? readAgentStampOrReport(output, rootDir, "question-reviser") : null;
  if (needsReviser && reviser === null) return EXIT.checkFailed;
  switch (options.mode) {
    case "request":
      return requestStep(options, paths, master.domains, facts, drafts, ledger, stamp as AgentStamp);
    case "revise":
      return reviseStep(options, paths, master.domains, facts, drafts, ledger, decisions, reviser as AgentStamp);
    case "rewrite":
      return rewriteStep(options, paths, master.domains, facts, drafts, ledger, provenance, reviser as AgentStamp);
    case "import":
      return importStep(options, paths, facts, drafts, ledger, provenance, decisions, {
        drafter: stamp as AgentStamp,
        reviser: reviser as AgentStamp,
      });
    case "check":
      return checkStep(options, facts, drafts, provenance, ledger, master.exam.vendor, decisions);
    case "review":
      return reviewStep(options, paths, facts, drafts, provenance, decisions, ledger, master.exam.vendor);
    case "decide":
      return decideStep(options, paths, facts, drafts, provenance, decisions, ledger, master.exam.vendor);
  }
}

/** 確認用の表と、判断を書き込むシートを、作業用の置き場に出す */
function reviewStep(
  options: DraftOptions,
  paths: Paths,
  facts: FactsFile,
  drafts: DraftsFile,
  provenance: ProvenanceFile,
  decisions: DecisionsFile,
  ledger: LedgerFile,
  vendor: string,
): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
  const skip = reviewSkipOf(options, facts, drafts, provenance, ledger, vendor);
  if (skip === "invalid") return EXIT.checkFailed;
  const { plan, paths: samplingPaths } = planFor(config, rootDir, examCode, { facts, drafts, provenance, decisions });
  const counts = reviewCounts(drafts, decisions, plan, skip);
  if (!dryRun) {
    mkdirSync(dirname(paths.reviewMd), { recursive: true });
    writeFileSync(paths.reviewMd, renderDraftReview(examCode, drafts, facts, provenance, decisions, plan, skip));
    writeJson(paths.reviewSheet, buildReviewSheet(examCode, drafts, decisions, plan, skip));
    // 抜き取りの結果(率、種、確認した件数、確認しなかった件数)を、人の判断の記録のそばに残す
    writeSampling(samplingPaths.record, recordOf(examCode, plan));
    report(output, "レビューレポート", relative(rootDir, paths.reviewMd));
    report(output, "レビューレポート", relative(rootDir, paths.reviewSheet));
    report(output, "レビューレポート", relative(rootDir, samplingPaths.record));
  } else {
    report(output, "書き込みをしない(dry-run)");
  }
  reportSampling(output, plan);
  reportReviewCounts(output, counts);
  return EXIT.ok;
}

/** 抜き取りの状態を報告する。件数と理由コードだけ */
function reportSampling(output: DraftOptions["output"], plan: SamplingPlan): void {
  const text =
    plan.mode === "sample"
      ? `抜き取り(率 ${plan.rate}、種 ${plan.seed}): 確認する下書き ${plan.draft.reviewed.length} 件、確認しない ${plan.draft.notReviewed.length} 件、確認する事実カード ${plan.fact.reviewed.length} 件、確認しない ${plan.fact.notReviewed.length} 件`
      : `全件の確認(理由 ${plan.fallback ?? "-"})`;
  report(output, "情報", text);
}

function reportReviewCounts(output: DraftOptions["output"], counts: ReturnType<typeof reviewCounts>): void {
  report(
    output,
    "情報",
    `人の確認: 要判断 ${counts.total} 件、承認 ${counts.approved} 件、却下 ${counts.rejected} 件、未済 ${counts.pending} 件` +
      `(ほかに、基準を満たして承認を省ける ${counts.byCriteria.length} 件、書き出し済み ${counts.exported.length} 件、` +
      `基準を満たすが来歴の検査で止まる ${counts.blocked.length} 件)`,
  );
}

/**
 * 人が判断しなくてよい下書きを、書き出し(export)と同じ判定で選ぶ。設定 review.autoApprove に挙げた試験だけで、
 * ほかの試験は、これまでどおり、不採用でない下書きをすべて確認の対象にする。
 */
function reviewSkipOf(
  options: DraftOptions,
  facts: FactsFile,
  drafts: DraftsFile,
  provenance: ProvenanceFile,
  ledger: LedgerFile,
  vendor: string,
): ReviewSkip | "invalid" {
  const { config, rootDir, examCode, output } = options;
  if (!config.review.autoApprove.includes(examCode)) return NO_SKIP;
  const published = readExistingTexts(config, rootDir, examCode);
  if (published === "invalid") {
    report(output, "問題データの誤り", `questions.${examCode.toLowerCase()}.json`);
    return "invalid";
  }
  const byCriteria = criteriaAccepted({
    drafts: drafts.drafts,
    examCode,
    targets: config.plan.overrides[examCode]?.services,
    services: ledger.guide?.services ?? [],
    publishedTexts: published,
  });
  const failed = new Set(
    [...checkProvenance(provenance, facts, vendor), ...checkRecheck(provenance, ledger)].map((p) => p.draftId),
  );
  const exported = new Set<string>();
  const blocked = new Set<string>();
  for (const d of drafts.drafts) {
    const entry = provenance.entries.find((e) => e.draftId === d.id);
    if (d.status === "passed" && entry?.questionId !== undefined) exported.add(d.id);
    if (entry === undefined || failed.has(d.id)) blocked.add(d.id);
  }
  return { byCriteria, exported, blocked };
}

/** 判断を書き込んだシートを検査し、人の判断の記録に取り込む */
function decideStep(
  options: DraftOptions,
  paths: Paths,
  facts: FactsFile,
  drafts: DraftsFile,
  provenance: ProvenanceFile,
  decisions: DecisionsFile,
  ledger: LedgerFile,
  vendor: string,
): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
  if (!existsSync(paths.reviewSheet)) {
    report(output, "入力の誤り", "判断のシートがない(draft --review を先に実行する)");
    return EXIT.inputError;
  }
  let sheet: ReviewSheet;
  try {
    const parsed = ReviewSheetSchema.safeParse(JSON.parse(readFileSync(paths.reviewSheet, "utf8")));
    if (!parsed.success) {
      for (const i of parsed.error.issues) report(output, "判断のシートの誤り", i.path.join(".") || "(全体)");
      return EXIT.checkFailed;
    }
    sheet = parsed.data;
  } catch {
    report(output, "判断のシートの誤り", "(JSON の形)");
    return EXIT.checkFailed;
  }
  if (sheet.examCode !== examCode) {
    report(output, "判断のシートの誤り", "examCode");
    return EXIT.checkFailed;
  }
  const result = decisionsFromSheet(sheet, drafts);
  for (const p of result.problems) report(output, "判断のシートの誤り", `items.${p.index} ${p.code}`);
  if (result.problems.length > 0) return EXIT.checkFailed;
  const next = upsertDecisions(decisions, result.decisions);
  // 取り込んだ判断を、下書きの状態にも反映して数える
  const applied = applyDraftDecisions(drafts, (id) => draftDecision(next, id));
  // 件数に要る入力(問題データ)が読めないときは、判断を書き込む前に止める(シートの誤りと同じく、何も取り込まない)
  const skip = reviewSkipOf(options, facts, applied.file, provenance, ledger, vendor);
  if (skip === "invalid") return EXIT.checkFailed;
  if (!dryRun) writeDecisions(paths.decisions, next);
  else report(output, "書き込みをしない(dry-run)");
  report(output, "情報", `判断の取り込み: ${result.decisions.length} 件、未記入 ${result.skipped} 件`);
  if (applied.changed > 0 && !dryRun) writeDrafts(paths.drafts, applied.file);
  // 数えるときは、記録した抜き取りの計画(確認しないと決めたもの)を使う。判断が増えても、確認の対象は変わらない
  const plan = recordedOrComputed(config, rootDir, examCode, {
    facts,
    drafts: applied.file,
    provenance,
    decisions: next,
  });
  reportReviewCounts(output, reviewCounts(applied.file, next, plan, skip));
  return EXIT.ok;
}

/**
 * 対象サービスの目標(試験ごとの設定 plan.overrides の services)と、試験ガイドの対象サービスの一覧がそろうときだけ、
 * 事実カードを選ぶ順の重みを返す(plan/services.ts)。数えるのは、公開済みの問題と、不採用でない本文のある下書き。
 * そろわなければ、重みをすべて同じにする(サービスで寄せない)
 */
function servicePriorityOf(
  options: DraftOptions,
  ledger: LedgerFile,
  drafts: DraftsFile,
): ((card: FactCard) => number) | "invalid" {
  const { config, rootDir, examCode } = options;
  const targets = config.plan.overrides[examCode]?.services;
  const services = ledger.guide?.services ?? [];
  if (targets === undefined || services.length === 0) return () => 0;
  const published = readExistingTexts(config, rootDir, examCode);
  if (published === "invalid") return "invalid";
  const drafted = drafts.drafts.flatMap((d) =>
    d.draft === null || d.status === "rejected"
      ? []
      : [[d.draft.questionText, ...(isChoiceDraft(d.draft) ? d.draft.choices.map((c) => c.text) : [])].join("\n")],
  );
  const status = serviceStatus([...published, ...drafted], services, targets);
  return (card) => servicePriority(card, services, status);
}

/** 論点の枠の依頼で、カードに添える先頭の出典のページと節 */
function focusSource(card: FactsFile["cards"][number]): { url: string; section: string; heading: string } {
  const source = card.sources[0];
  return { url: source?.url ?? "", section: source?.section ?? "", heading: source?.anchor.heading ?? "" };
}

function requestStep(
  options: DraftOptions,
  paths: Paths,
  masterDomains: { code: string; name: string }[],
  facts: FactsFile,
  drafts: DraftsFile,
  ledger: LedgerFile,
  stamp: AgentStamp,
): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
  let plan: PlanFile | null;
  try {
    plan = readPlan(paths.plan);
  } catch (error) {
    if (error instanceof PlanError) {
      for (const p of error.paths) report(output, "出題計画の誤り", p);
      return EXIT.checkFailed;
    }
    throw error;
  }
  if (plan === null) {
    report(output, "入力の誤り", "出題計画がない(plan を先に実行する)");
    return EXIT.inputError;
  }
  const state = readState(paths.state);
  // 事実カードごとに、下書きの根拠にされた回数を数える。人が却下した下書きと、直して置き換えた下書きの根拠も数える
  // (本文はないが、残した ID で数える)。同じカードが補充の依頼で、使われていない扱いに戻って再び選ばれないようにするため
  const usage = new Map<string, number>();
  for (const d of drafts.drafts) {
    for (const id of usedFactIds(d)) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  // 出典ごとに、根拠にされた回数を数える(不採用の下書きは数えない)。使われていない出典の事実カードを先に選ぶため
  const cardById = new Map(facts.cards.map((c) => [c.id, c]));
  const sourceUsage = new Map<string, number>();
  // 選択式の種別ごとに、正答の位置(記号の組)の使われた回数を数える。依頼で、少ない位置を正答の位置に指定するため
  const positionCounts = { single: new Map<string, number>(), multiple: new Map<string, number>() };
  for (const d of drafts.drafts) {
    if (d.draft === null || d.status === "rejected") continue;
    for (const id of d.draft.factIds) {
      const card = cardById.get(id);
      if (card !== undefined) sourceUsage.set(factSource(card), (sourceUsage.get(factSource(card)) ?? 0) + 1);
    }
    if (isChoiceDraft(d.draft)) {
      const counts = positionCounts[d.draft.questionType];
      const key = positionKey(d.draft.correctAnswers);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  const settings = config.draft;
  const priority = servicePriorityOf(options, ledger, drafts);
  if (priority === "invalid") {
    report(output, "問題データの誤り", `questions.${examCode.toLowerCase()}.json`);
    return EXIT.checkFailed;
  }
  const styleGuides = requestStyleGuides(rootDir, examCode);
  let requested = 0;
  let satisfied = 0;
  let cached = 0;
  let pending = 0;
  let exhausted = 0;
  let limited = false;
  const noFacts = new Set<string>();
  // 前の実行で満たせなかった計画の項目と理由。今回の実行で見た項目は、今回の判定で置き換える(解消した項目は外れる)
  for (const [id, reasons] of Object.entries(state.unmet)) report(output, "前回の未達", `${id} ${reasons.join(",")}`);
  const unmet: Record<string, UnmetReason[]> = {};
  const examined = new Set<string>();
  const items = options.domain === undefined ? plan.items : plan.items.filter((i) => i.domain === options.domain);
  for (const item of items) {
    examined.add(item.id);
    const have = drafts.drafts.filter((d) => d.planItemId === item.id && d.status !== "rejected").length;
    const remaining = item.count - have;
    if (remaining <= 0) {
      satisfied++;
      continue;
    }
    // 再検証の印がある事実カードと、根拠の出典が active でないか本文が変わった事実カードは、根拠の候補にしない
    // 論点の枠の項目は、枠の出典の範囲のカードだけを候補にする(分野は問わない)
    const focus = item.focus;
    const cards = facts.cards.filter(
      (c) =>
        usableFact(c, ledger) &&
        (focus === undefined
          ? c.domain === item.domain
          : c.sources.some((s) => focus.sourcePrefixes.some((p) => s.url.startsWith(p)))),
    );
    if (cards.length === 0) {
      const scope = focus === undefined ? item.domain : `focus:${focus.id}`;
      if (!noFacts.has(scope)) report(output, "下書きの誤り", `no-facts ${scope}`);
      noFacts.add(scope);
      unmet[item.id] = ["no-facts"];
      continue;
    }
    const round = state.rounds[item.id] ?? 0;
    if (round >= settings.maxRounds) {
      report(output, "再試行の上限", `${item.id} max-rounds`);
      unmet[item.id] = ["max-rounds"];
      exhausted++;
      continue;
    }
    const selected = selectFacts(cards, usage, settings.maxFactsPerRequest, sourceUsage, priority);
    const count = Math.min(remaining, settings.maxPerRequest);
    // 人の却下は、出し直しの回数(上限の maxRounds)に数えず、鍵に入れて足りない分の依頼を出す
    const humanRejected = drafts.drafts.filter(
      (d) => d.planItemId === item.id && d.status === "rejected" && d.reasons.includes(HUMAN_REJECTED),
    ).length;
    const key = requestKey({
      examCode,
      planItemId: item.id,
      count,
      round,
      facts: selected,
      definitionHash: stamp.definitionHash,
      humanRejected,
      ...(focus !== undefined ? { focusInstruction: focus.instruction } : {}),
    });
    if (state.done.includes(key)) {
      cached++;
      continue;
    }
    if ((state.attempts[key] ?? 0) >= settings.maxAttempts) {
      report(output, "再試行の上限", `${item.id} max-attempts`);
      unmet[item.id] = ["max-attempts"];
      exhausted++;
      continue;
    }
    const requestPath = join(paths.requestsDir, `${key}.json`);
    // 同じ実行の次の依頼は、まだ使われていない事実カードを先に選ぶ(同じ根拠の下書きが並ばないようにする)。
    // 待ちの依頼の事実カードも足す。足さないと、後ろの項目の選び方と鍵が初回の実行と変わり、別の鍵の依頼が重ねて書かれる
    const countUsage = () => {
      for (const c of selected.slice(0, count)) {
        usage.set(c.id, (usage.get(c.id) ?? 0) + 1);
        sourceUsage.set(factSource(c), (sourceUsage.get(factSource(c)) ?? 0) + 1);
      }
    };
    if (existsSync(requestPath)) {
      countUsage();
      pending++;
      continue;
    }
    if (requested >= config.maxItemsPerRun) {
      limited = true;
      examined.delete(item.id);
      break;
    }
    const request: DraftRequest = {
      examCode,
      requestKey: key,
      planItemId: item.id,
      domain: {
        code: item.domain,
        name: masterDomains.find((d) => d.code === item.domain)?.name ?? item.domain,
      },
      difficulty: item.difficulty,
      kind: item.kind,
      count,
      facts: selected.map((c) => ({
        id: c.id,
        claim: c.claim,
        confidence: c.confidence,
        scope: c.scope,
        ...(focus !== undefined ? { source: focusSource(c) } : {}),
      })),
      ...(item.kind === "free-text"
        ? {}
        : { answerPositions: assignAnswerPositions(item.kind, count, positionCounts[item.kind]) }),
      distractorTypes: [...DISTRACTOR_TYPES],
      styleVersion: STYLE_VERSION,
      ...(styleGuides !== null ? { styleGuides } : {}),
      styleRules: styleRuleSummaries(item.kind),
      ...(focus !== undefined ? { focus: { instruction: focus.instruction } } : {}),
      outputPath: relative(rootDir, join(paths.outDir, `${key}.json`)),
      agent: stamp,
    };
    if (!dryRun) writeJson(requestPath, request);
    countUsage();
    report(output, "下書きの依頼", relative(rootDir, requestPath));
    requested++;
  }
  report(
    output,
    "情報",
    `依頼 ${requested} 件、依頼済みで待っている ${pending} 件、計画を満たして飛ばした ${satisfied} 件、取り込み済みの入力で飛ばした ${cached} 件`,
  );
  // 今回見なかった項目(件数の上限で止まった後ろの項目)は、前の記録を残す。計画にない項目は外す
  const planIds = new Set(plan.items.map((i) => i.id));
  for (const [id, reasons] of Object.entries(state.unmet)) {
    if (planIds.has(id) && !examined.has(id)) unmet[id] = reasons;
  }
  if (dryRun) report(output, "書き込みをしない(dry-run)");
  else writeState(paths.state, { ...state, unmet });
  if (limited) report(output, "件数の上限", "maxItemsPerRun(再実行で続きから進む)");
  return limited || exhausted > 0 || noFacts.size > 0 ? EXIT.checkFailed : EXIT.ok;
}

/**
 * 直しの依頼を書く(draft --revise。ブラッシュアップ役 question-reviser)。保留の選択式の下書きで、人の判断がまだないものごとに、
 * 元の下書き、保留の理由、検証の指摘、根拠の節の場所、元の根拠と周辺の事実カードを載せた依頼を 1 件ずつ書く。書かせる数は 1。
 * 元の根拠の事実カードが使えなくなった下書きは、直しの材料がそろわないので依頼しない(作り直しは、通常の依頼で行う)。
 */
function reviseStep(
  options: DraftOptions,
  paths: Paths,
  masterDomains: { code: string; name: string }[],
  facts: FactsFile,
  drafts: DraftsFile,
  ledger: LedgerFile,
  decisions: DecisionsFile,
  stamp: AgentStamp,
): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
  const state = readState(paths.state);
  const usage = new Map<string, number>();
  for (const d of drafts.drafts) for (const id of usedFactIds(d)) usage.set(id, (usage.get(id) ?? 0) + 1);
  const styleGuides = requestStyleGuides(rootDir, examCode);
  let requested = 0;
  let pending = 0;
  let cached = 0;
  let skipped = 0;
  let limited = false;
  const targets = reviseTargets(drafts, (id) => draftDecision(decisions, id));
  for (const record of targets) {
    const candidates = facts.cards.filter((c) => c.domain === record.domain && usableFact(c, ledger));
    if (!record.draft.factIds.every((id) => candidates.some((c) => c.id === id))) {
      report(output, "直しの保留", `${record.id} fact-not-usable`);
      skipped++;
      continue;
    }
    const selected = reviseFacts(record, candidates, usage, config.draft.maxFactsPerRequest);
    const key = requestKey({
      examCode,
      planItemId: record.planItemId,
      count: 1,
      round: 0,
      facts: selected,
      definitionHash: stamp.definitionHash,
      reviseOf: record.id,
    });
    if (state.done.includes(key)) {
      cached++;
      continue;
    }
    if ((state.attempts[key] ?? 0) >= config.draft.maxAttempts) {
      report(output, "再試行の上限", `${record.id} max-attempts`);
      skipped++;
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
    const kind = record.draft.questionType;
    const request: DraftRequest = {
      examCode,
      requestKey: key,
      planItemId: record.planItemId,
      domain: { code: record.domain, name: masterDomains.find((d) => d.code === record.domain)?.name ?? record.domain },
      difficulty: record.difficulty,
      kind,
      count: 1,
      facts: selected.map((c) => ({ id: c.id, claim: c.claim, confidence: c.confidence, scope: c.scope })),
      // 正答の位置は、元の下書きのものを保つ(正答の位置の偏りを変えない)
      answerPositions: [[...record.draft.correctAnswers].sort()],
      distractorTypes: [...DISTRACTOR_TYPES],
      styleVersion: STYLE_VERSION,
      ...(styleGuides !== null ? { styleGuides } : {}),
      styleRules: styleRuleSummaries(kind),
      outputPath: relative(rootDir, join(paths.outDir, `${key}.json`)),
      agent: stamp,
      revise: {
        draftId: record.id,
        draft: record.draft,
        reasons: record.reasons,
        findings: (record.verification?.findings ?? []).map((f) => ({ code: f.code, where: f.where })),
        sections: evidenceLocations(record.draft.factIds, facts),
      },
    };
    if (!dryRun) writeJson(requestPath, request);
    report(output, "直しの依頼", relative(rootDir, requestPath));
    requested++;
  }
  report(
    output,
    "情報",
    `直しの依頼 ${requested} 件、依頼済みで待っている ${pending} 件、取り込み済みの入力で飛ばした ${cached} 件、依頼しなかった ${skipped} 件(対象 ${targets.length} 件)`,
  );
  if (dryRun) report(output, "書き込みをしない(dry-run)");
  if (limited) report(output, "件数の上限", "maxItemsPerRun(再実行で続きから進む)");
  return limited || skipped > 0 ? EXIT.checkFailed : EXIT.ok;
}

/**
 * 書き直しの依頼を書く(draft --rewrite。ブラッシュアップ役 question-reviser。ADR 0023)。非公開のファイルの問題で、判定が「書き直しで復帰できる」ものごとに、
 * 現行の本文、判定の理由コード、根拠の節の場所、元の根拠と周辺の事実カードを載せた依頼を 1 件ずつ書く。書かせる数は 1。
 * 来歴のない問題(パイプラインで作っていない問題)と、元の根拠の事実カードが使えなくなった問題は、材料がそろわないので依頼しない。
 */
function rewriteStep(
  options: DraftOptions,
  paths: Paths,
  masterDomains: { code: string; name: string }[],
  facts: FactsFile,
  drafts: DraftsFile,
  ledger: LedgerFile,
  provenance: ProvenanceFile,
  stamp: AgentStamp,
): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
  const unpublished = readUnpublished(config, rootDir, examCode);
  if (unpublished === "invalid") {
    report(output, "問題データの誤り", `unpublished.${examCode.toLowerCase()}.json`);
    return EXIT.checkFailed;
  }
  const state = readState(paths.state);
  const usage = new Map<string, number>();
  for (const d of drafts.drafts) for (const id of usedFactIds(d)) usage.set(id, (usage.get(id) ?? 0) + 1);
  const styleGuides = requestStyleGuides(rootDir, examCode);
  let requested = 0;
  let pending = 0;
  let cached = 0;
  let skipped = 0;
  let limited = false;
  const targets = rewriteTargets(unpublished, drafts.drafts);
  for (const target of targets) {
    const { question } = target.entry;
    const id = question.questionId;
    if (question.questionType === "free-text") continue;
    const own = provenance.entries.find((e) => e.questionId === id);
    if (own === undefined) {
      report(output, "書き直しの保留", `${id} no-provenance`);
      skipped++;
      continue;
    }
    const candidates = facts.cards.filter((c) => c.domain === question.domain && usableFact(c, ledger));
    if (!own.factIds.every((fid) => candidates.some((c) => c.id === fid))) {
      report(output, "書き直しの保留", `${id} fact-not-usable`);
      skipped++;
      continue;
    }
    const selected = reviseFacts(
      { draft: { factIds: own.factIds } },
      candidates,
      usage,
      config.draft.maxFactsPerRequest,
    );
    const planItemId = rewritePlanItemId(id);
    const key = requestKey({
      examCode,
      planItemId,
      count: 1,
      round: 0,
      facts: selected,
      definitionHash: stamp.definitionHash,
      rewriteOf: { questionId: id, contentHash: target.contentHash, round: target.round },
    });
    if (state.done.includes(key)) {
      cached++;
      continue;
    }
    if ((state.attempts[key] ?? 0) >= config.draft.maxAttempts) {
      report(output, "再試行の上限", `${id} max-attempts`);
      skipped++;
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
    const kind = question.questionType;
    const request: DraftRequest = {
      examCode,
      requestKey: key,
      planItemId,
      domain: {
        code: question.domain,
        name: masterDomains.find((d) => d.code === question.domain)?.name ?? question.domain,
      },
      difficulty: question.difficulty ?? "medium",
      kind,
      count: 1,
      facts: selected.map((c) => ({ id: c.id, claim: c.claim, confidence: c.confidence, scope: c.scope })),
      // 正答の位置は、元の問題のものを保つ
      answerPositions: [[...question.correctAnswers].sort()],
      distractorTypes: [...DISTRACTOR_TYPES],
      styleVersion: STYLE_VERSION,
      ...(styleGuides !== null ? { styleGuides } : {}),
      styleRules: styleRuleSummaries(kind),
      outputPath: relative(rootDir, join(paths.outDir, `${key}.json`)),
      agent: stamp,
      rewrite: {
        questionId: id,
        verdict: "rewritable",
        question: {
          questionType: kind,
          questionText: question.questionText,
          choices: question.choices.map((c) => ({ key: c.key, text: c.text })),
          correctAnswers: [...question.correctAnswers],
          explanation: question.explanation,
        },
        factIds: own.factIds,
        reasons: target.entry.reasons,
        sections: evidenceLocations(own.factIds, facts),
      },
    };
    if (!dryRun) writeJson(requestPath, request);
    report(output, "書き直しの依頼", relative(rootDir, requestPath));
    requested++;
  }
  report(
    output,
    "情報",
    `書き直しの依頼 ${requested} 件、依頼済みで待っている ${pending} 件、取り込み済みの入力で飛ばした ${cached} 件、依頼しなかった ${skipped} 件(対象 ${targets.length} 件)`,
  );
  if (dryRun) report(output, "書き込みをしない(dry-run)");
  if (limited) report(output, "件数の上限", "maxItemsPerRun(再実行で続きから進む)");
  return limited || skipped > 0 ? EXIT.checkFailed : EXIT.ok;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function importStep(
  options: DraftOptions,
  paths: Paths,
  facts: FactsFile,
  current: DraftsFile,
  ledger: LedgerFile,
  provenance: ProvenanceFile,
  decisions: DecisionsFile,
  stamps: { drafter: AgentStamp; reviser: AgentStamp },
): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
  const ctx: FlowContext = { output, stopLabel: "下書きの取り込みの停止", dryRun };
  // 直しの依頼で取り込んだ下書きが置き換える、直す前の下書きの ID(直す前 → 直した下書き)
  const revised = new Map<string, string>();
  // 直しで設問文と根拠の事実カードを変えなかった下書きは、直す前と同じ ID になる。その記録を、直した内容で置き換える(ID → 直した記録)
  const inPlace = new Map<string, DraftRecord>();
  const state = readState(paths.state);
  // 取得した本文の作業用キャッシュ(下書きの写しの検査に使う。本文を書き足さない。読むと更新時刻が変わり、壊れた本文は消える)
  const cache = new BodyCache(join(resolve(rootDir, config.workDir), "cache"), config.cache, Date.now);
  const requestFiles = listRequestFiles(paths.requestsDir);
  const published = readPublishedCandidates(config, rootDir, examCode);
  if (published === "invalid") {
    report(output, "問題データの誤り", `questions.${examCode.toLowerCase()}.json`);
    return EXIT.checkFailed;
  }
  const unpublished = readUnpublished(config, rootDir, examCode);
  if (unpublished === "invalid") {
    report(output, "問題データの誤り", `unpublished.${examCode.toLowerCase()}.json`);
    return EXIT.checkFailed;
  }
  // ベンダーの用語の辞書(ない場合は、辞書を使う規則は何も止めない)
  let terms: Terms | null;
  try {
    terms = readTerms(rootDir, vendorOf(examCode));
  } catch (error) {
    if (!(error instanceof TermsError)) throw error;
    for (const p of error.paths) report(output, "用語の辞書の誤り", p);
    return EXIT.checkFailed;
  }
  // 重複を比べる相手: 公開済みの問題(読み取り専用)と、不採用でない下書き
  const pool = [
    ...published,
    ...current.drafts.flatMap((d) => (d.draft === null ? [] : [candidateOf(d.id, "draft", d.draft)])),
  ];
  const incoming: DraftRecord[] = [];
  const entries = new Map<string, ProvenanceEntry>();
  const doneFiles: string[] = [];
  let failures = 0;
  let accepted = 0;
  let heldCount = 0;
  let rejected = 0;

  for (const file of requestFiles) {
    const key = file.replace(/\.json$/, "");
    const outPath = join(paths.outDir, file);
    if (!existsSync(outPath)) {
      report(output, "下書きの出力なし", key);
      continue;
    }
    let request: DraftRequest;
    try {
      const parsed = DraftRequestSchema.safeParse(JSON.parse(readFileSync(join(paths.requestsDir, file), "utf8")));
      if (!parsed.success || parsed.data.requestKey !== key) throw new Error("request-invalid");
      request = parsed.data;
    } catch {
      reportStop(ctx, key, "request-invalid");
      failures++;
      continue;
    }
    // 直しと書き直しの依頼はブラッシュアップ役、それ以外は下書きの作成役の定義で作った下書き
    const stamp = request.revise !== undefined || request.rewrite !== undefined ? stamps.reviser : stamps.drafter;
    // 依頼のあとにエージェントの定義が変わった(記録のない古い依頼を含む)。出力の形を見る前に、依頼を作り直す
    if (definitionChanged(request, stamp)) {
      discardStale(ctx, key, join(paths.requestsDir, file), outPath);
      continue;
    }
    // 直しの依頼のあとに、直す下書きが保留でなくなった(人が判断した、ほかの直しで置き換わった)。直しの意味がないので依頼を捨てる
    const reviseOf = request.revise?.draftId;
    if (
      reviseOf !== undefined &&
      (revised.has(reviseOf) ||
        inPlace.has(reviseOf) ||
        current.drafts.find((d) => d.id === reviseOf)?.status !== "held" ||
        draftDecision(decisions, reviseOf) !== undefined)
    ) {
      discardStale(ctx, key, join(paths.requestsDir, file), outPath);
      continue;
    }
    // 書き直しの依頼のあとに、非公開の問題が変わった(公開へ戻った、本文が変わった、判定が変わった)、または、ほかの書き直しの下書きが生きている。依頼を捨てる
    const rewriteEntry = request.rewrite?.questionId;
    if (request.rewrite !== undefined) {
      const entry = unpublished?.entries.find((e) => e.question.questionId === request.rewrite?.questionId);
      const input = entry === undefined ? null : inputFromQuestion(entry.question);
      const rewritten = [...current.drafts, ...incoming].some(
        (d) => d.rewriteOf === request.rewrite?.questionId && d.status !== "rejected",
      );
      if (
        entry === undefined ||
        entry.verdict !== "rewritable" ||
        input === null ||
        requestKey({
          examCode,
          planItemId: request.planItemId,
          count: 1,
          round: 0,
          facts: request.facts,
          definitionHash: stamp.definitionHash,
          rewriteOf: {
            questionId: request.rewrite.questionId,
            contentHash: contentHash(input),
            round: current.drafts.filter(
              (d) => d.rewriteOf === request.rewrite?.questionId && d.reasons.includes(HUMAN_REJECTED),
            ).length,
          },
        }) !== key ||
        rewritten
      ) {
        discardStale(ctx, key, join(paths.requestsDir, file), outPath);
        continue;
      }
    }
    // 書き直しの下書きを直した下書きも、元の問題の ID を引き継ぐ(同じ内容かの比較も、元の問題と行う)
    const rewriteId = rewriteEntry ?? current.drafts.find((d) => d.id === reviseOf)?.rewriteOf;
    const rewriteOriginal =
      rewriteId === undefined ? undefined : unpublished?.entries.find((e) => e.question.questionId === rewriteId);
    const fail = (reason: string) => {
      failOutput(ctx, key, reason, outPath, state.attempts);
      failures++;
    };
    let out: ReturnType<typeof DraftsOutputSchema.parse>;
    try {
      const parsed = DraftsOutputSchema.safeParse(JSON.parse(readFileSync(outPath, "utf8")));
      if (!parsed.success) throw new Error("output-invalid");
      out = parsed.data;
    } catch {
      fail("output-invalid");
      continue;
    }
    if (out.examCode !== examCode || out.requestKey !== request.requestKey || out.planItemId !== request.planItemId) {
      fail("request-mismatch");
      continue;
    }
    if (out.drafts.length > request.count) {
      fail("output-invalid");
      continue;
    }
    // 依頼のあとに、事実カードが変わった(消えた、通過でなくなった、主張が変わった、再検証の印が付いた、出典が使えなくなった)。依頼を作り直す
    const stale = request.facts.some((f) => {
      const card = facts.cards.find((c) => c.id === f.id);
      return card === undefined || card.claim !== f.claim || !usableFact(card, ledger);
    });
    if (stale) {
      discardStale(ctx, key, join(paths.requestsDir, file), outPath);
      continue;
    }
    const factIds = new Set(request.facts.map((f) => f.id));
    const batch: DraftRecord[] = [];
    for (const draft of out.drafts) {
      const id = draftId(examCode, request.planItemId, draft.factIds, draft.questionText);
      const reasons: string[] = [];
      let copied: ReturnType<typeof copyCheck> = "ok";
      if (draft.questionType !== request.kind) reasons.push("kind-mismatch");
      if (!draft.factIds.every((f) => factIds.has(f))) reasons.push("fact-not-in-request");
      const verdict = evaluateStyle(draft, undefined, { terms });
      for (const f of verdict.blockers) reasons.push(`style:${f.rule}`);
      // 誤答の検査は選択式だけ(自由記述に誤答はない)
      const distractors = isChoiceDraft(draft)
        ? checkDistractors(draft, {
            factIds,
            claims: draft.factIds.flatMap((fid) => facts.cards.find((c) => c.id === fid)?.claim ?? []),
          })
        : { blockers: [], warnings: [], ambiguous: [] };
      for (const f of distractors.blockers) reasons.push(`distractor:${f.code}`);
      // 範囲の検査(ADR 0024): 対象外のサービスが主題・正答なら不採用。誤答だけ、一覧にない名前は警告
      const scope = isChoiceDraft(draft)
        ? scopeFindings(
            {
              stem: draft.questionText,
              choices: draft.choices.map((c) => c.text),
              correct: draft.correctAnswers.map((a) => draft.choices.findIndex((c) => c.key === a)),
            },
            scopeListsOf(ledger.guide),
          )
        : { outOfScopeSubject: false, outOfScopeDistractor: false, unlisted: null };
      if (scope.outOfScopeSubject) reasons.push("scope:out-of-scope-subject");
      if (reasons.length === 0) {
        const urls = uniqueSorted(
          draft.factIds.flatMap((fid) => facts.cards.find((c) => c.id === fid)?.sources.map((s) => s.url) ?? []),
        ).slice(0, 10);
        // 書き直しは、元の問題と、分野・出典・論点が同じでなければならない(ADR 0023)。元の問題が非公開のファイルにないときも、書き直しとして取り込まない
        if (rewriteId !== undefined) {
          const originFactIds = provenance.entries.find((e) => e.questionId === rewriteId)?.factIds ?? [];
          if (rewriteOriginal === undefined || originFactIds.length === 0) reasons.push("rewrite:original-missing");
          else {
            const before = identityOf({
              domain: rewriteOriginal.question.domain,
              referenceUrls: (rewriteOriginal.question.references ?? []).map((r) => r.url),
              topics: topicsOf(originFactIds, facts),
            });
            const after = identityOf({
              domain: request.domain.code,
              referenceUrls: urls,
              topics: topicsOf(draft.factIds, facts),
            });
            reasons.push(...sameContentProblems(before, after));
          }
        }
        const problems = schemaProblems(
          assembleQuestion(draft, {
            examCode,
            domain: request.domain.code,
            difficulty: request.difficulty,
            references: urls.map((url) => ({ url })),
          }),
        );
        // 形の検査を通っても、データの検査に落ちた下書きは、その下書きだけを不採用にする(場所だけを持ち、値は含めない)
        if (problems.length > 0) {
          for (const p of uniqueSorted(problems.map(pathCode))) reasons.push(`data-invalid:${p}`);
        } else {
          copied = copyCheck(draft, facts, cache);
          if (copied === "copy") {
            // 根拠の出典の本文を長く写した下書きは、本文を残さずに不採用にする
            reasons.push("long-copy");
          } else {
            const built = buildEntry(id, draft.factIds, facts, ledger);
            if ("reasons" in built) for (const r of built.reasons) reasons.push(`provenance:${r}`);
            else entries.set(id, built.entry);
          }
        }
      }
      for (const f of verdict.blockers) report(output, "下書きの不採用", `${id} ${f.rule} ${f.path}`);
      for (const f of distractors.blockers) report(output, "下書きの不採用", `${id} ${f.code} ${f.path}`);
      for (const r of reasons.filter((r) => !r.startsWith("style:") && !r.startsWith("distractor:"))) {
        report(output, "下書きの不採用", `${id} ${r}`);
      }
      // 重複の検出: 公開済みの問題や下書きとほぼ同じなら落とし、近ければ保留にして確かめる
      // 直した下書きは、直す前の下書きとは比べない(同じ問いを直したものなので、似ているのが当然)
      // 書き直した下書きも、書き直す元の問題の下書き(来歴でつながる下書き)とは比べない
      const rewriteOriginDraftId =
        rewriteId === undefined ? undefined : provenance.entries.find((e) => e.questionId === rewriteId)?.draftId;
      const others = pool.filter((c) => c.ref !== reviseOf && c.ref !== rewriteOriginDraftId);
      const dups =
        reasons.length === 0 ? findDuplicates(candidateOf(id, "draft", draft), others, config.draft.similarity) : [];
      for (const f of dups.filter((d) => d.level === "duplicate")) {
        reasons.push(`duplicate:${f.kind}-${f.source}`);
        report(output, "下書きの不採用", `${id} duplicate-${f.kind} ${f.other} ${f.score.toFixed(2)}`);
      }
      if (reasons.length > 0) entries.delete(id);
      const warnings = [
        ...verdict.warnings.map((f) => ({ rule: f.rule, path: f.path })),
        ...distractors.warnings.map((f) => ({ rule: f.code, path: f.path })),
        ...scorecardWarnings(draft, examCode),
        ...(scope.outOfScopeDistractor ? [{ rule: "scope-out-of-scope-distractor", path: "choices" }] : []),
        ...(scope.unlisted !== null ? [{ rule: "scope-unlisted-service", path: scope.unlisted }] : []),
      ];
      for (const w of warnings) report(output, "下書きの警告", `${id} ${w.rule} ${w.path}`);
      // 正答が複数になりうる候補は、モデルによる検査(検証の段階)で確かめるまで、先へ進めない
      const holdDups = dups.filter((d) => d.level === "hold");
      const held =
        reasons.length === 0 && (distractors.ambiguous.length > 0 || holdDups.length > 0 || copied === "unchecked");
      if (held) {
        // 根拠の出典の本文がキャッシュにないと、写しを確かめられない。確かめるまで先へ進めない
        if (copied === "unchecked") {
          reasons.push("review:copy-unchecked");
          report(output, "下書きの保留", `${id} review-copy-unchecked`);
        }
        for (const f of distractors.ambiguous) {
          reasons.push(`ambiguous:${f.code}`);
          report(output, "下書きの保留", `${id} ambiguous:${f.code} ${f.path}`);
        }
        for (const f of holdDups) {
          reasons.push(`review:${f.kind}-${f.source}`);
          report(output, "下書きの保留", `${id} review-${f.kind} ${f.other} ${f.score.toFixed(2)}`);
        }
      }
      batch.push({
        id,
        planItemId: request.planItemId,
        domain: request.domain.code,
        difficulty: request.difficulty,
        status: held ? "held" : reasons.length > 0 ? "rejected" : "passed",
        reasons: uniqueSorted(reasons),
        warnings,
        draft: held || reasons.length === 0 ? draft : null,
        agent: stamp,
        similarity: maxSimilarity(candidateOf(id, "draft", draft), others),
        ...(reviseOf !== undefined ? { revisionOf: reviseOf } : {}),
        ...(rewriteId !== undefined ? { rewriteOf: rewriteId } : {}),
      });
      // 以降の下書きは、この下書きとも比べる
      if (held || reasons.length === 0) pool.push(candidateOf(id, "draft", draft));
    }
    const known = new Set([...current.drafts, ...incoming].map((d) => d.id));
    for (const record of batch) {
      if (reviseOf !== undefined && record.id === reviseOf) {
        // 同じ ID の直し。不採用でなければ、直す前の記録を置き換える(検証の結果は持たないので、検証からやり直す)。
        // 不採用なら、直す前の下書きは保留のまま残る
        if (record.status !== "rejected") {
          const { revisionOf: _self, ...replaced } = record;
          inPlace.set(record.id, replaced);
          if (record.status === "passed") accepted++;
          else heldCount++;
        } else {
          rejected++;
        }
        continue;
      }
      if (known.has(record.id)) continue;
      known.add(record.id);
      incoming.push(record);
      if (record.status === "passed") accepted++;
      else if (record.status === "held") heldCount++;
      else rejected++;
    }
    const takenHere = batch.filter((r) => r.status !== "rejected").length;
    state.done.push(key);
    if (reviseOf !== undefined) {
      // 直した下書きが不採用でなければ、直す前の下書きを置き換える。不採用なら、直す前の下書きは保留のまま残る
      const taken = batch.find((r) => r.status !== "rejected" && incoming.includes(r));
      if (taken !== undefined) revised.set(reviseOf, taken.id);
    } else if (request.rewrite === undefined && takenHere === 0) {
      // 全件が不採用だったときだけ、計画の項目の依頼を出し直す(回数に上限がある)。直しと書き直しの依頼は数えない
      state.rounds[request.planItemId] = (state.rounds[request.planItemId] ?? 0) + 1;
    }
    doneFiles.push(file);
  }

  report(
    output,
    "情報",
    `取り込み: 通過 ${accepted} 件、保留 ${heldCount} 件、不採用 ${rejected} 件、停止 ${failures} 件`,
  );
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return failures > 0 ? EXIT.checkFailed : EXIT.ok;
  }
  // 直した下書きに置き換わった下書きは、不採用(理由 revised)にして本文を持たない。根拠の事実カードの ID だけを残す
  const kept = current.drafts.map((d): DraftRecord => {
    const replaced = inPlace.get(d.id);
    if (replaced !== undefined) return replaced;
    if (!revised.has(d.id)) return d;
    const factIds = usedFactIds(d);
    return {
      ...d,
      status: "rejected",
      reasons: [REVISED],
      draft: null,
      ...(factIds.length > 0 ? { factIds: [...factIds] } : {}),
    };
  });
  for (const [from, to] of revised) report(output, "直しの取り込み", `${from} → ${to}`);
  for (const id of inPlace.keys()) report(output, "直しの取り込み", `${id}(同じ ID で置き換え)`);
  const next: DraftsFile = { examCode, drafts: [...kept, ...incoming] };
  // 捨てた出力の分が entries に残っていても、取り込んだ下書き(incoming)の ID だけを使うので、来歴には入らない
  const added = [...incoming.filter((d) => d.status !== "rejected"), ...inPlace.values()].flatMap(
    (d) => entries.get(d.id) ?? [],
  );
  // 来歴を先に書く。下書きより先に来歴があっても害はなく、逆は「来歴のない下書き」になる
  // 置き換わった下書きの来歴は外す(不採用の下書きは来歴を持たない)
  if (added.length > 0 || revised.size > 0) {
    const ids = new Set([...added.map((e) => e.draftId), ...revised.keys()]);
    writeProvenance(paths.provenance, {
      examCode,
      entries: [...provenance.entries.filter((e) => !ids.has(e.draftId)), ...added],
    });
  }
  if (incoming.length > 0 || revised.size > 0 || inPlace.size > 0) writeDrafts(paths.drafts, next);
  // 正解の偏り: 選択式の下書き(通過・保留)と公開済みの問題を合わせて、データの検査と同じ指標としきい値で数える。報告だけで止めない
  const choiceDrafts = next.drafts.flatMap((d) =>
    d.status !== "rejected" && d.draft !== null && isChoiceDraft(d.draft) ? [d.draft] : [],
  );
  const bias = checkAnswerBias("下書きと公開済みの問題", [
    ...readPublishedChoices(config, rootDir, examCode),
    ...choiceDrafts,
  ]);
  for (const message of [...bias.errors, ...bias.warnings]) report(output, "正解の偏り", message);
  writeState(paths.state, state);
  cleanupImported(doneFiles, paths.requestsDir, paths.outDir);
  return failures > 0 ? EXIT.checkFailed : EXIT.ok;
}

/**
 * データの検査の場所(`rubric.passingPoints`、`choices.0.key` など)を、理由コードの形(英小文字・数字・ハイフン)にする。
 * 値は含めない。場所のない誤り(全体)は `root`。
 */
export function pathCode(path: string): string {
  const code = path
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return code === "" ? "root" : code;
}

function checkStep(
  options: DraftOptions,
  facts: FactsFile,
  drafts: DraftsFile,
  provenance: ProvenanceFile,
  ledger: LedgerFile,
  vendor: string,
  decisions: DecisionsFile,
): ExitCode {
  const { config, rootDir, examCode, output } = options;
  // 人の確認の済み・未済を報告する(未済は失敗にしない)
  const plan = recordedOrComputed(config, rootDir, examCode, { facts, drafts, provenance, decisions });
  reportSampling(output, plan);
  const skip = reviewSkipOf(options, facts, drafts, provenance, ledger, vendor);
  if (skip === "invalid") return EXIT.checkFailed;
  reportReviewCounts(output, reviewCounts(drafts, decisions, plan, skip));
  // 形と根拠の検査に、再検証の検査(来歴と台帳の今の状態の比較)を足す
  const problems = [...checkProvenance(provenance, facts, vendor), ...checkRecheck(provenance, ledger)];
  for (const p of problems) report(output, "来歴の誤り", `${p.draftId} ${p.code}`);
  const missing = unprovenanced(drafts.drafts, provenance);
  for (const id of missing) report(output, "来歴なし", id);
  const ready = drafts.drafts.filter((d) => d.status === "passed" && !missing.includes(d.id)).length;
  report(
    output,
    "情報",
    `来歴の検査: 来歴のある通過済みの下書き ${ready} 件、来歴の誤り ${problems.length} 件、来歴なし ${missing.length} 件`,
  );
  return problems.length > 0 || missing.length > 0 ? EXIT.checkFailed : EXIT.ok;
}
