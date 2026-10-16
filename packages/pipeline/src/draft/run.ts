import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { loadExam } from "../collect/collect.ts";
import { LedgerError, type LedgerFile, ledgerPath, readLedger } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import { EXAM_CODE } from "../contract.ts";
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
import { FactsError, type FactsFile, factsPath, readFacts } from "../facts/schema.ts";
import { type Output, report } from "../log.ts";
import { PlanError, type PlanFile, planPath, readPlan } from "../plan/schema.ts";
import { candidateOf, findDuplicates, readPublishedCandidates } from "./dedupe.ts";
import { checkDistractors } from "./distractors.ts";
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
  type DraftRequest,
  DraftRequestSchema,
  DraftsOutputSchema,
  requestKey,
  selectFacts,
  styleRuleSummaries,
} from "./request.ts";
import {
  buildReviewSheet,
  decisionsFromSheet,
  type ReviewSheet,
  ReviewSheetSchema,
  renderDraftReview,
  reviewCounts,
} from "./review.ts";
import { assembleQuestion, DISTRACTOR_TYPES, draftId, isChoiceDraft, schemaProblems } from "./schema.ts";
import {
  applyDraftDecisions,
  type DraftRecord,
  DraftsError,
  type DraftsFile,
  draftWorkDir,
  readDrafts,
  readState,
  type UnmetReason,
  writeDrafts,
  writeState,
} from "./store.ts";
import { evaluateStyle, STYLE_VERSION } from "./style.ts";

/**
 * draft コマンド: 出題計画と事実カードから、選択式の問題の下書きを作る。
 * - draft <資格コード>            計画の項目ごとに、下書きの依頼を作業用の置き場に書く(同じ入力は依頼しない)
 * - draft <資格コード> --import   エージェントの出力を検査して取り込む(形、スタイル規則、根拠の事実カード、来歴)
 * - draft <資格コード> --check    下書きの来歴を検査する(来歴のない下書きは、検証の段階へ進めない)
 * モデルは呼ばない。下書きはエージェント(question-drafter)が書く(ADR 0009)。data/ は変えない。
 */

export type DraftMode = "request" | "import" | "check" | "review" | "decide";

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

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function runDraft(options: DraftOptions): ExitCode {
  const { config, rootDir, examCode, output } = options;
  if (!EXAM_CODE.test(examCode)) {
    report(output, "入力の誤り", "資格コードの形");
    return EXIT.inputError;
  }
  let master: ReturnType<typeof loadExam>;
  try {
    master = loadExam(config, rootDir, examCode);
  } catch {
    report(output, "資格マスタの誤り", config.examsFile);
    return EXIT.inputError;
  }
  if (master === null || master.officialQuestionCount === null) {
    report(output, "入力の誤り", "公開中の資格ではない");
    return EXIT.inputError;
  }
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
  switch (options.mode) {
    case "request":
      return requestStep(options, paths, master.domains, facts, drafts, ledger);
    case "import":
      return importStep(options, paths, facts, drafts, ledger, provenance);
    case "check":
      return checkStep(options, facts, drafts, provenance, ledger, master.exam.vendor, decisions);
    case "review":
      return reviewStep(options, paths, facts, drafts, provenance, decisions);
    case "decide":
      return decideStep(options, paths, drafts, decisions);
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
): ExitCode {
  const { rootDir, examCode, output, dryRun } = options;
  const counts = reviewCounts(drafts, decisions);
  if (!dryRun) {
    mkdirSync(dirname(paths.reviewMd), { recursive: true });
    writeFileSync(paths.reviewMd, renderDraftReview(examCode, drafts, facts, provenance, decisions));
    writeJson(paths.reviewSheet, buildReviewSheet(examCode, drafts, decisions));
    report(output, "レビューレポート", relative(rootDir, paths.reviewMd));
    report(output, "レビューレポート", relative(rootDir, paths.reviewSheet));
  } else {
    report(output, "書き込みをしない(dry-run)");
  }
  reportReviewCounts(output, counts);
  return EXIT.ok;
}

function reportReviewCounts(output: DraftOptions["output"], counts: ReturnType<typeof reviewCounts>): void {
  report(
    output,
    "情報",
    `人の確認: 対象 ${counts.total} 件、承認 ${counts.approved} 件、却下 ${counts.rejected} 件、未済 ${counts.pending} 件`,
  );
}

/** 判断を書き込んだシートを検査し、人の判断の記録に取り込む */
function decideStep(options: DraftOptions, paths: Paths, drafts: DraftsFile, decisions: DecisionsFile): ExitCode {
  const { examCode, output, dryRun } = options;
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
  if (!dryRun) writeDecisions(paths.decisions, next);
  else report(output, "書き込みをしない(dry-run)");
  report(output, "情報", `判断の取り込み: ${result.decisions.length} 件、未記入 ${result.skipped} 件`);
  // 取り込んだ判断を、下書きの状態にも反映して数える
  const applied = applyDraftDecisions(drafts, (id) => draftDecision(next, id));
  if (applied.changed > 0 && !dryRun) writeDrafts(paths.drafts, applied.file);
  reportReviewCounts(output, reviewCounts(applied.file, next));
  return EXIT.ok;
}

function requestStep(
  options: DraftOptions,
  paths: Paths,
  masterDomains: { code: string; name: string }[],
  facts: FactsFile,
  drafts: DraftsFile,
  ledger: LedgerFile,
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
  const usage = new Map<string, number>();
  for (const d of drafts.drafts) {
    if (d.draft === null) continue;
    for (const id of d.draft.factIds) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  const settings = config.draft;
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
    const cards = facts.cards.filter((c) => c.domain === item.domain && usableFact(c, ledger));
    if (cards.length === 0) {
      if (!noFacts.has(item.domain)) report(output, "下書きの誤り", `no-facts ${item.domain}`);
      noFacts.add(item.domain);
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
    const selected = selectFacts(cards, usage, settings.maxFactsPerRequest);
    const count = Math.min(remaining, settings.maxPerRequest);
    const key = requestKey({ examCode, planItemId: item.id, count, round, facts: selected });
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
    if (existsSync(requestPath)) {
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
      facts: selected.map((c) => ({ id: c.id, claim: c.claim, confidence: c.confidence, scope: c.scope })),
      distractorTypes: [...DISTRACTOR_TYPES],
      styleVersion: STYLE_VERSION,
      styleRules: styleRuleSummaries(item.kind),
      outputPath: relative(rootDir, join(paths.outDir, `${key}.json`)),
    };
    if (!dryRun) writeJson(requestPath, request);
    // 同じ実行の次の依頼は、まだ使われていない事実カードを先に選ぶ(同じ根拠の下書きが並ばないようにする)
    for (const c of selected.slice(0, count)) usage.set(c.id, (usage.get(c.id) ?? 0) + 1);
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
): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
  const state = readState(paths.state);
  const requestFiles = existsSync(paths.requestsDir)
    ? readdirSync(paths.requestsDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  const published = readPublishedCandidates(config, rootDir, examCode);
  if (published === "invalid") {
    report(output, "問題データの誤り", `questions.${examCode.toLowerCase()}.json`);
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
      report(output, "下書きの取り込みの停止", `${key} request-invalid`);
      failures++;
      continue;
    }
    const fail = (reason: string) => {
      report(output, "下書きの取り込みの停止", `${key} ${reason}`);
      failures++;
      if (!dryRun) {
        state.attempts[key] = (state.attempts[key] ?? 0) + 1;
        rmSync(outPath, { force: true });
      }
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
      report(output, "下書きの取り込みの停止", `${key} request-stale`);
      if (!dryRun) {
        rmSync(join(paths.requestsDir, file), { force: true });
        rmSync(outPath, { force: true });
      }
      continue;
    }
    const factIds = new Set(request.facts.map((f) => f.id));
    const batch: DraftRecord[] = [];
    for (const draft of out.drafts) {
      const id = draftId(examCode, request.planItemId, draft.factIds, draft.questionText);
      const reasons: string[] = [];
      if (draft.questionType !== request.kind) reasons.push("kind-mismatch");
      if (!draft.factIds.every((f) => factIds.has(f))) reasons.push("fact-not-in-request");
      const verdict = evaluateStyle(draft);
      for (const f of verdict.blockers) reasons.push(`style:${f.rule}`);
      // 誤答の検査は選択式だけ(自由記述に誤答はない)
      const distractors = isChoiceDraft(draft)
        ? checkDistractors(draft, {
            factIds,
            claims: draft.factIds.flatMap((fid) => facts.cards.find((c) => c.id === fid)?.claim ?? []),
          })
        : { blockers: [], warnings: [], ambiguous: [] };
      for (const f of distractors.blockers) reasons.push(`distractor:${f.code}`);
      if (reasons.length === 0) {
        const urls = uniqueSorted(
          draft.factIds.flatMap((fid) => facts.cards.find((c) => c.id === fid)?.sources.map((s) => s.url) ?? []),
        ).slice(0, 10);
        const problems = schemaProblems(
          assembleQuestion(draft, {
            examCode,
            domain: request.domain.code,
            difficulty: request.difficulty,
            referenceUrls: urls,
          }),
        );
        // 形の検査を通っても、データの検査に落ちた下書きは、その下書きだけを不採用にする(場所だけを持ち、値は含めない)
        if (problems.length > 0) {
          for (const p of uniqueSorted(problems.map(pathCode))) reasons.push(`data-invalid:${p}`);
        } else {
          const built = buildEntry(id, draft.factIds, facts, ledger);
          if ("reasons" in built) for (const r of built.reasons) reasons.push(`provenance:${r}`);
          else entries.set(id, built.entry);
        }
      }
      for (const f of verdict.blockers) report(output, "下書きの不採用", `${id} ${f.rule} ${f.path}`);
      for (const f of distractors.blockers) report(output, "下書きの不採用", `${id} ${f.code} ${f.path}`);
      for (const r of reasons.filter((r) => !r.startsWith("style:") && !r.startsWith("distractor:"))) {
        report(output, "下書きの不採用", `${id} ${r}`);
      }
      // 重複の検出: 公開済みの問題や下書きとほぼ同じなら落とし、近ければ保留にして確かめる
      const dups =
        reasons.length === 0 ? findDuplicates(candidateOf(id, "draft", draft), pool, config.draft.similarity) : [];
      for (const f of dups.filter((d) => d.level === "duplicate")) {
        reasons.push(`duplicate:${f.kind}-${f.source}`);
        report(output, "下書きの不採用", `${id} duplicate-${f.kind} ${f.other} ${f.score.toFixed(2)}`);
      }
      if (reasons.length > 0) entries.delete(id);
      const warnings = [
        ...verdict.warnings.map((f) => ({ rule: f.rule, path: f.path })),
        ...distractors.warnings.map((f) => ({ rule: f.code, path: f.path })),
      ];
      for (const w of warnings) report(output, "下書きの警告", `${id} ${w.rule} ${w.path}`);
      // 正答が複数になりうる候補は、モデルによる検査(検証の段階)で確かめるまで、先へ進めない
      const holdDups = dups.filter((d) => d.level === "hold");
      const held = reasons.length === 0 && (distractors.ambiguous.length > 0 || holdDups.length > 0);
      if (held) {
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
      });
      // 以降の下書きは、この下書きとも比べる
      if (held || reasons.length === 0) pool.push(candidateOf(id, "draft", draft));
    }
    const known = new Set([...current.drafts, ...incoming].map((d) => d.id));
    for (const record of batch) {
      if (known.has(record.id)) continue;
      known.add(record.id);
      incoming.push(record);
      if (record.status === "passed") accepted++;
      else if (record.status === "held") heldCount++;
      else rejected++;
    }
    const takenHere = batch.filter((r) => r.status !== "rejected").length;
    state.done.push(key);
    // 全件が不採用だったときだけ、計画の項目の依頼を出し直す(回数に上限がある)
    if (takenHere === 0) state.rounds[request.planItemId] = (state.rounds[request.planItemId] ?? 0) + 1;
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
  const next: DraftsFile = { examCode, drafts: [...current.drafts, ...incoming] };
  // 捨てた出力の分が entries に残っていても、取り込んだ下書き(incoming)の ID だけを使うので、来歴には入らない
  const added = incoming.filter((d) => d.status !== "rejected").flatMap((d) => entries.get(d.id) ?? []);
  // 来歴を先に書く。下書きより先に来歴があっても害はなく、逆は「来歴のない下書き」になる
  if (added.length > 0) {
    const ids = new Set(added.map((e) => e.draftId));
    writeProvenance(paths.provenance, {
      examCode,
      entries: [...provenance.entries.filter((e) => !ids.has(e.draftId)), ...added],
    });
  }
  if (incoming.length > 0) writeDrafts(paths.drafts, next);
  writeState(paths.state, state);
  for (const file of doneFiles) {
    rmSync(join(paths.requestsDir, file), { force: true });
    rmSync(join(paths.outDir, file), { force: true });
  }
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
  const { output } = options;
  // 人の確認の済み・未済を報告する(未済は失敗にしない)
  reportReviewCounts(output, reviewCounts(drafts, decisions));
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
