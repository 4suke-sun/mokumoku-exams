import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { z } from "zod";
import { LedgerError, ledgerPath, readLedger } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import { QuestionsFileSchema } from "../contract.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { factsWorkDir, pendingSources, readState } from "../facts/facts.ts";
import { FactsError, factsPath, readFacts } from "../facts/schema.ts";
import { type Output, report } from "../log.ts";
import { readAgentStampOrReport } from "../shared/agents.ts";
import { prepareExam } from "../shared/exam.ts";
import { evidenceCounts, MIN_EVIDENCE_CARDS } from "./evidence.ts";
import { buildPlan, type ExistingQuestion, resolveSettings } from "./plan.ts";
import { PlanError, type PlanItem, planPath, writePlan } from "./schema.ts";
import { serviceStatus } from "./services.ts";

export interface PlanOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  dryRun: boolean;
  output: Output;
}

type PublishedQuestion = z.infer<typeof QuestionsFileSchema>["questions"][number];

/** 公開済みの問題を読み取り専用で読む。ファイルがなければ空 */
function readPublished(config: Config, rootDir: string, examCode: string): PublishedQuestion[] | "invalid" {
  const file = resolve(rootDir, dirname(config.examsFile), `questions.${examCode.toLowerCase()}.json`);
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return "invalid";
  }
  const parsed = QuestionsFileSchema.safeParse(raw);
  return parsed.success ? parsed.data.questions : "invalid";
}

/** 公開済みの問題の、計画に使う項目だけを読む。本文は使わない */
export function readExistingQuestions(
  config: Config,
  rootDir: string,
  examCode: string,
): ExistingQuestion[] | "invalid" {
  const questions = readPublished(config, rootDir, examCode);
  if (questions === "invalid") return "invalid";
  return questions.map((q) => ({ domain: q.domain, difficulty: q.difficulty, kind: q.questionType }));
}

/** 公開済みの問題の本文(設問文と選択肢)を、問題ごとに 1 つの文字列で読む。対象サービスの数え上げに使う */
export function readExistingTexts(config: Config, rootDir: string, examCode: string): string[] | "invalid" {
  const questions = readPublished(config, rootDir, examCode);
  if (questions === "invalid") return "invalid";
  return questions.map((q) => [q.questionText, ...("choices" in q ? q.choices.map((c) => c.text) : [])].join("\n"));
}

/**
 * 事実カードをまだ抽出していない出典を数える。facts が件数の上限で止まったまま計画に進むと、
 * 根拠の足りない計画になるため、plan の入口で確かめる。読めなければ null(誤りは報告済み)
 */
function countPendingSources(options: PlanOptions): number | null {
  const { config, rootDir, examCode, output } = options;
  try {
    const ledger = readLedger(ledgerPath(resolve(rootDir, config.ledgerDir), examCode), examCode);
    // 取得済みの出典がなければ、エージェントの定義を読まずに 0 件とする(出典を集める前の計画)
    if (!ledger.sources.some((s) => s.status === "active" && s.contentHash !== null && s.kind !== "exam-guide"))
      return 0;
    const facts = readFacts(factsPath(resolve(rootDir, config.factsDir), examCode), examCode);
    const stamp = readAgentStampOrReport(output, rootDir, "fact-extractor");
    if (stamp === null) return null;
    const state = readState(join(factsWorkDir(config, rootDir, examCode), "state.json"));
    const pending = pendingSources(ledger, facts, stamp, state, config.facts.maxAttempts);
    for (const url of pending) report(output, "事実カードの未処理", url);
    return pending.length;
  } catch (error) {
    if (error instanceof LedgerError) for (const p of error.paths) report(output, "台帳の誤り", p);
    else if (error instanceof FactsError) for (const p of error.paths) report(output, "事実カードの誤り", p);
    else throw error;
    return null;
  }
}

/**
 * 対象サービスの目標(試験ごとの設定)と、試験ガイドの対象サービスの一覧がそろうとき、公開済みの問題で、
 * 下限に届かないサービスと、割合の上限を超えるサービスを報告する。目標は下書きの依頼で事実カードの選び方に効く(計画の項目は変えない)。
 * 読めなければ false(誤りは報告済み)
 */
function reportServices(options: PlanOptions): boolean {
  const { config, rootDir, examCode, output } = options;
  const targets = config.plan.overrides[examCode]?.services;
  if (targets === undefined) return true;
  let services: string[];
  try {
    services = readLedger(ledgerPath(resolve(rootDir, config.ledgerDir), examCode), examCode).guide?.services ?? [];
  } catch (error) {
    if (!(error instanceof LedgerError)) throw error;
    for (const p of error.paths) report(output, "台帳の誤り", p);
    return false;
  }
  if (services.length === 0) {
    report(output, "対象サービスの目標", "試験ガイドの対象サービスの一覧がない(collect で試験ガイドを取り込み直す)");
    return true;
  }
  const texts = readExistingTexts(config, rootDir, examCode);
  if (texts === "invalid") {
    report(output, "問題データの誤り", `questions.${examCode.toLowerCase()}.json`);
    return false;
  }
  const status = serviceStatus(texts, services, targets);
  report(
    output,
    "対象サービスの目標",
    `一覧 ${services.length} 件、下限(${targets.minPerService} 問)に届かない ${status.below.length} 件、` +
      `割合の上限(${Math.round(targets.maxShare * 100)}%)を超える ${status.above.length} 件`,
  );
  for (const s of status.below) report(output, "下限に届かないサービス", `${s} ${status.counts.get(s) ?? 0} 問`);
  for (const s of status.above)
    report(output, "上限を超えるサービス", `${s} ${status.counts.get(s) ?? 0}/${status.total} 問`);
  return true;
}

/**
 * 計画の項目ごとに、根拠にできる事実カードの数を報告する。目安(MIN_EVIDENCE_CARDS)に届かない項目は「不足」と出す。止めない。
 * 台帳か事実カードが読めない、または取得済みの出典がないときは、何も報告しない(読めない誤りは、ほかの確かめが報告する)。
 */
function reportEvidence(options: PlanOptions, items: readonly PlanItem[]): void {
  const { config, rootDir, examCode, output } = options;
  try {
    const ledger = readLedger(ledgerPath(resolve(rootDir, config.ledgerDir), examCode), examCode);
    if (!ledger.sources.some((s) => s.status === "active" && s.contentHash !== null && s.kind !== "exam-guide")) return;
    const facts = readFacts(factsPath(resolve(rootDir, config.factsDir), examCode), examCode);
    const counts = evidenceCounts(items, facts, ledger);
    for (const c of counts) {
      report(
        output,
        "根拠の事実カード",
        `${c.itemId} ${c.scope} ${c.cards} 件${c.short ? `(不足。目安 ${MIN_EVIDENCE_CARDS} 件)` : ""}`,
      );
    }
  } catch (error) {
    if (!(error instanceof LedgerError) && !(error instanceof FactsError)) throw error;
  }
}

/** plan コマンド: 分野の配点から目標の問題数を出し、既存の問題との差を、作業用の置き場に書く。data/ は変えない */
export function runPlan(options: PlanOptions): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
  const exam = prepareExam(options, { production: true });
  if (!exam.ok) return exam.exit;
  const master = exam.master;
  // 事実カードを抽出していない出典が残っていれば、計画を作らない(facts を、件数の上限の通知が出なくなるまで繰り返す)
  const pending = countPendingSources(options);
  if (pending === null) return EXIT.checkFailed;
  if (pending > 0) {
    report(
      output,
      "事実カードの未処理",
      `出典 ${pending} 件(facts を、件数の上限の通知が出なくなるまで繰り返してから plan を実行する)`,
    );
    return EXIT.checkFailed;
  }
  const existing = readExistingQuestions(config, rootDir, examCode);
  if (existing === "invalid") {
    report(output, "問題データの誤り", `questions.${examCode.toLowerCase()}.json`);
    return EXIT.checkFailed;
  }
  let plan: ReturnType<typeof buildPlan>;
  try {
    plan = buildPlan({
      examCode,
      domains: master.domains,
      existing,
      settings: resolveSettings(config.plan, examCode, master.officialQuestionCount),
    });
  } catch (error) {
    if (error instanceof PlanError) {
      for (const p of error.paths) report(output, "出題計画の誤り", p);
      return EXIT.checkFailed;
    }
    throw error;
  }
  for (const d of plan.domains) {
    report(output, "出題計画", `${d.domain} 目標 ${d.target} 件、既存 ${d.existing} 件、不足 ${d.missing} 件`);
  }
  report(
    output,
    "情報",
    `目標 ${plan.targetTotal} 件、既存 ${plan.existingTotal} 件、計画の項目 ${plan.items.length} 件`,
  );
  if (!reportServices(options)) return EXIT.checkFailed;
  reportEvidence(options, plan.items);
  const path = planPath(resolve(rootDir, config.workDir), examCode);
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return EXIT.ok;
  }
  try {
    writePlan(path, plan);
  } catch (error) {
    if (error instanceof PlanError) {
      for (const p of error.paths) report(output, "出題計画の誤り", p);
      return EXIT.checkFailed;
    }
    throw error;
  }
  report(output, "出題計画", relative(rootDir, path));
  return EXIT.ok;
}
