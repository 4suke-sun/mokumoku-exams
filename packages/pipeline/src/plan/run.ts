import { existsSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { loadExam } from "../collect/collect.ts";
import type { Config } from "../config.ts";
import { EXAM_CODE, QuestionsFileSchema } from "../contract.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { type Output, report } from "../log.ts";
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

/** plan コマンド: 分野の配点から目標の問題数を出し、既存の問題との差を、作業用の置き場に書く。data/ は変えない */
export function runPlan(options: PlanOptions): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
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
  if (master === null) {
    report(output, "入力の誤り", "資格マスタにない資格コード");
    return EXIT.inputError;
  }
  if (master.officialQuestionCount === null || master.domains.length === 0) {
    report(output, "入力の誤り", "公開中の資格ではない");
    return EXIT.inputError;
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
