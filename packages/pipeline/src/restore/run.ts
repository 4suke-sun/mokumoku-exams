import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { LedgerError, type LedgerFile, ledgerPath, readLedger } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import { ExamsFileSchema, QuestionsFileSchema, UnpublishedFileSchema, validateDataSet } from "../contract.ts";
import {
  DecisionsError,
  type DecisionsFile,
  decisionsPath,
  draftDecision,
  readDecisions,
} from "../decisions/decisions.ts";
import {
  checkProvenance,
  checkRecheck,
  ProvenanceError,
  type ProvenanceFile,
  provenancePath,
  readProvenance,
  writeProvenance,
} from "../draft/provenance.ts";
import { identityOf, readUnpublished, sameContentProblems, topicsOf } from "../draft/rewrite.ts";
import { assembleQuestion, isChoiceDraft } from "../draft/schema.ts";
import { type DraftRecord, DraftsError, draftWorkDir, readDrafts } from "../draft/store.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { formatJson, references } from "../export/export.ts";
import { FactsError, type FactsFile, factsPath, readFacts } from "../facts/schema.ts";
import { readCriteria } from "../judge/criteria.ts";
import { contentHash, inputFromQuestion } from "../judge/input.ts";
import { readJudgeResults } from "../judge/run.ts";
import { type Output, report } from "../log.ts";
import { readAgentStampOrReport } from "../shared/agents.ts";
import { prepareExam } from "../shared/exam.ts";
import { readJsonFile } from "../shared/request-flow.ts";
import { isVerified } from "../verify/schema.ts";

/**
 * restore コマンド: 書き直した非公開の問題を、非公開のファイルから公開の問題データへ、同じ ID のまま戻す(ADR 0023)。
 * 戻すのは、次をすべて満たす書き直しの下書き(rewriteOf を持つ)だけ。満たさないものは、理由を報告して戻さない。
 * - 元の問題が非公開のファイルにあり、判定が「書き直しで復帰できる」である
 * - 人が承認した(抜き取りにしない)。検証役の検証を通った
 * - 来歴の検査と再検証の検査を通った
 * - 分野・出典の URL・論点が、元の問題と同じである
 * - 判定役が、書き直した内容で「公開」と判定した(問題の ID・本文のハッシュ・判定の基準・判定役の定義が、いまのものと一致する)
 * 書く前に、戻したあとのデータ全体の検査を通し、失敗したら何も書かない。書き込みが途中で失敗したときは、2 つのファイルを元に戻す。
 * 戻した作業は、作業ツリーの `data/` の変更として、PR の差分で確かめる。モデルは呼ばない。出力は、問題の ID・件数・理由コードだけ。
 */

export interface RestoreOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  dryRun: boolean;
  output: Output;
}

export function runRestore(options: RestoreOptions): ExitCode {
  const { config, rootDir, examCode, dryRun, output } = options;
  const exam = prepareExam(options, { production: true });
  if (!exam.ok) return exam.exit;
  const code = examCode.toLowerCase();
  const dataDir = resolve(rootDir, dirname(config.examsFile));
  const work = resolve(rootDir, config.workDir);
  const paths = {
    questions: join(dataDir, `questions.${code}.json`),
    unpublished: join(dataDir, `unpublished.${code}.json`),
    results: join(work, "judge", code, "results.json"),
    facts: factsPath(resolve(rootDir, config.factsDir), examCode),
    ledger: ledgerPath(resolve(rootDir, config.ledgerDir), examCode),
    provenance: provenancePath(resolve(rootDir, config.provenanceDir), examCode),
    decisions: decisionsPath(resolve(rootDir, config.decisionsDir), examCode),
    drafts: join(draftWorkDir(work, examCode), "drafts.json"),
  };
  if (!existsSync(paths.questions)) {
    report(output, "入力の誤り", "問題データがない");
    return EXIT.inputError;
  }
  const unpublished = readUnpublished(config, rootDir, examCode);
  if (unpublished === "invalid") {
    report(output, "問題データの誤り", relative(rootDir, paths.unpublished));
    return EXIT.inputError;
  }
  if (unpublished === null) {
    report(output, "公開への復帰", "非公開のファイルがない(戻す問題がない)");
    return EXIT.ok;
  }
  const published = QuestionsFileSchema.safeParse(readJsonFile(paths.questions));
  if (!published.success) {
    report(output, "問題データの誤り", relative(rootDir, paths.questions));
    return EXIT.inputError;
  }
  const criteria = readCriteria(rootDir, examCode);
  if (criteria === null) {
    report(output, "入力の誤り", "判定の基準がない(資格別の文書に「判定の基準」の節がない)");
    return EXIT.inputError;
  }
  const stamp = readAgentStampOrReport(output, rootDir, "question-judge");
  if (stamp === null) return EXIT.checkFailed;
  const judged = existsSync(paths.results) ? readJudgeResults(paths.results, examCode) : { examCode, entries: [] };
  if (judged === null) {
    report(output, "入力の誤り", "判定の結果が読めない");
    return EXIT.inputError;
  }
  let facts: FactsFile;
  let ledger: LedgerFile;
  let provenance: ProvenanceFile;
  let decisions: DecisionsFile;
  let drafts: DraftRecord[];
  try {
    facts = readFacts(paths.facts, examCode);
    ledger = readLedger(paths.ledger, examCode);
    provenance = readProvenance(paths.provenance, examCode);
    decisions = readDecisions(paths.decisions, examCode);
    drafts = readDrafts(paths.drafts, examCode).drafts;
  } catch (error) {
    if (error instanceof FactsError) for (const p of error.paths) report(output, "事実カードの誤り", p);
    else if (error instanceof LedgerError) for (const p of error.paths) report(output, "台帳の誤り", p);
    else if (error instanceof ProvenanceError) for (const p of error.paths) report(output, "来歴の誤り", p);
    else if (error instanceof DecisionsError) for (const p of error.paths) report(output, "判断の記録の誤り", p);
    else if (error instanceof DraftsError) for (const p of error.paths) report(output, "下書きの誤り", p);
    else throw error;
    return EXIT.checkFailed;
  }
  const problems = [
    ...checkProvenance(provenance, facts, exam.master.exam.vendor),
    ...checkRecheck(provenance, ledger),
  ];

  const rewrites = drafts
    .filter((d) => d.rewriteOf !== undefined && d.status === "passed" && d.draft !== null)
    .sort((a, b) => ((a.rewriteOf as string) < (b.rewriteOf as string) ? -1 : 1));
  const restored: { id: string; question: Record<string, unknown>; draftId: string }[] = [];
  let kept = 0;
  for (const d of rewrites) {
    const id = d.rewriteOf as string;
    const why = (reason: string) => {
      report(output, "公開に戻さない", `${id} ${reason}`);
      kept++;
    };
    const draft = d.draft;
    const entry = unpublished.entries.find((e) => e.question.questionId === id);
    if (draft === null || !isChoiceDraft(draft)) continue;
    if (restored.some((r) => r.id === id)) {
      why("duplicate-rewrite");
      continue;
    }
    if (entry === undefined || entry.verdict !== "rewritable") {
      why("not-rewritable");
      continue;
    }
    if (draftDecision(decisions, d.id) !== "approve") {
      why("not-approved");
      continue;
    }
    if (!isVerified(d.verification, draftDecision(decisions, d.id))) {
      why("not-verified");
      continue;
    }
    const provenanceEntry = provenance.entries.find((e) => e.draftId === d.id);
    if (provenanceEntry === undefined || problems.some((p) => p.draftId === d.id)) {
      why("provenance");
      continue;
    }
    const original = provenance.entries.find((e) => e.questionId === id);
    const base = assembleQuestion(draft, {
      examCode,
      domain: d.domain,
      difficulty: d.difficulty,
      references: references(
        provenanceEntry.sources.flatMap((s) => {
          const source = ledger.sources.find((l) => l.url === s.url);
          return [{ url: s.url, ...(source?.title !== undefined ? { title: source.title } : {}) }];
        }),
        exam.master.exam.vendor,
      ),
    }) as Record<string, unknown>;
    // 書き直しで作らない項目(タグ)は、元の問題のものを引き継ぐ
    const tags = (entry.question as { tags?: string[] }).tags;
    const question = { ...base, questionId: id, ...(tags !== undefined ? { tags } : {}) };
    const sameProblems = sameContentProblems(
      identityOf({
        domain: entry.question.domain,
        referenceUrls: (entry.question.references ?? []).map((r) => r.url),
        topics: topicsOf(original?.factIds ?? [], facts),
      }),
      identityOf({
        domain: d.domain,
        referenceUrls: ((base as { references?: { url: string }[] }).references ?? []).map((r) => r.url),
        topics: topicsOf(draft.factIds, facts),
      }),
    );
    if (original === undefined || sameProblems.length > 0) {
      why(original === undefined ? "rewrite:original-missing" : sameProblems.join(","));
      continue;
    }
    const input = inputFromQuestion(question as Parameters<typeof inputFromQuestion>[0]);
    const verdict = judged.entries.find((e) => e.questionId === id);
    if (
      input === null ||
      verdict === undefined ||
      verdict.contentHash !== contentHash(input) ||
      verdict.criteriaHash !== criteria.hash ||
      verdict.agent.definitionHash !== stamp.definitionHash
    ) {
      why("judge-missing-or-stale");
      continue;
    }
    if (verdict.verdict !== "publish") {
      why(`judge-${verdict.verdict}`);
      continue;
    }
    restored.push({ id, question, draftId: d.id });
  }
  report(
    output,
    "公開への復帰",
    `書き直した下書き ${rewrites.length} 件のうち、戻す ${restored.length} 問、戻さない ${kept} 問`,
  );
  if (restored.length === 0) return kept > 0 ? EXIT.checkFailed : EXIT.ok;

  const restoredIds = new Set(restored.map((r) => r.id));
  const nextPublished = { ...published.data, questions: [...published.data.questions] as unknown[] };
  for (const r of restored) {
    // 元の並び(問題 ID の順)を保つ。自分より大きい ID の問題の手前に入れる
    const at = (nextPublished.questions as { questionId: string }[]).findIndex((q) => q.questionId > r.id);
    nextPublished.questions.splice(at < 0 ? nextPublished.questions.length : at, 0, r.question);
  }
  const remaining = unpublished.entries.filter((e) => !restoredIds.has(e.question.questionId));
  const nextUnpublished = remaining.length === 0 ? null : { ...unpublished, entries: remaining };

  // 書く前に、データ全体の検査を通す(失敗したら何も書かない)
  const examsRaw = readJsonFile(resolve(rootDir, config.examsFile));
  if (!ExamsFileSchema.safeParse(examsRaw).success) {
    report(output, "資格マスタの誤り", config.examsFile);
    return EXIT.inputError;
  }
  const files = (pattern: RegExp, name: string, replacement: unknown | null) =>
    readdirSync(dataDir)
      .filter((f) => pattern.test(f) && !(f === name && replacement === null))
      .sort()
      .map((f) => ({ name: f, data: f === name ? replacement : (readJsonFile(join(dataDir, f)) as unknown) }));
  const errors = validateDataSet(
    examsRaw,
    files(/^questions\..+\.json$/, `questions.${code}.json`, nextPublished),
    undefined,
    [],
    files(/^unpublished\..+\.json$/, `unpublished.${code}.json`, nextUnpublished),
  );
  if (errors.length > 0 || !UnpublishedFileSchema.safeParse(nextUnpublished ?? unpublished).success) {
    report(output, "データの検査の失敗", `${errors.length} 件(何も書かなかった)`);
    return EXIT.checkFailed;
  }
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return kept > 0 ? EXIT.checkFailed : EXIT.ok;
  }

  const originalPublished = readFileSync(paths.questions, "utf8");
  const originalUnpublished = readFileSync(paths.unpublished, "utf8");
  const rollback = () => {
    writeFileSync(paths.questions, originalPublished);
    writeFileSync(paths.unpublished, originalUnpublished);
  };
  try {
    writeFileSync(paths.questions, formatJson(`${JSON.stringify(nextPublished, null, 2)}\n`, rootDir));
    if (nextUnpublished === null) rmSync(paths.unpublished, { force: true });
    else writeFileSync(paths.unpublished, formatJson(`${JSON.stringify(nextUnpublished, null, 2)}\n`, rootDir));
    // 来歴は、いまの問題の根拠を指す。戻した問題の古い項目を外し、書き直した下書きの項目に問題の ID を書く
    mkdirSync(dirname(paths.provenance), { recursive: true });
    writeProvenance(paths.provenance, {
      ...provenance,
      entries: [...provenance.entries.filter((e) => e.questionId === undefined || !restoredIds.has(e.questionId))].map(
        (e) => {
          const r = restored.find((x) => x.draftId === e.draftId);
          return r === undefined ? e : { ...e, questionId: r.id };
        },
      ),
    });
  } catch (error) {
    rollback();
    throw error;
  }
  for (const r of restored) report(output, "公開への復帰", `${r.id} を公開へ戻した`);
  report(
    output,
    "情報",
    `戻した: ${relative(rootDir, paths.questions)}(非公開は ${relative(rootDir, paths.unpublished)})`,
  );
  // 戻さなかった問題が残るときは、止めたものとして終了コード 1 にする
  return kept > 0 ? EXIT.checkFailed : EXIT.ok;
}
