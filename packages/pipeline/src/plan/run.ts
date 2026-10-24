import { existsSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { LedgerError, ledgerPath, readLedger } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import { QuestionsFileSchema } from "../contract.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { factsWorkDir, pendingSources, readState } from "../facts/facts.ts";
import { FactsError, factsPath, readFacts } from "../facts/schema.ts";
import { type Output, report } from "../log.ts";
import { readAgentStampOrReport } from "../shared/agents.ts";
import { prepareExam } from "../shared/exam.ts";
import { buildPlan, type ExistingQuestion, resolveSettings } from "./plan.ts";
import { PlanError, planPath, writePlan } from "./schema.ts";

export interface PlanOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  dryRun: boolean;
  output: Output;
}

/** 公開済みの問題を読み取り専用で読む。ファイルがなければ空。本文は使わない */
export function readExistingQuestions(
  config: Config,
  rootDir: string,
  examCode: string,
): ExistingQuestion[] | "invalid" {
  const file = resolve(rootDir, dirname(config.examsFile), `questions.${examCode.toLowerCase()}.json`);
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return "invalid";
  }
  const parsed = QuestionsFileSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  return parsed.data.questions.map((q) => ({
    domain: q.domain,
    difficulty: q.difficulty,
    kind: q.questionType,
  }));
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
