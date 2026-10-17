import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { ExamInfo } from "../collect/checks.ts";
import { LedgerError } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import { EXAM_CODE, ExamsFileSchema } from "../contract.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { type Output, report } from "../log.ts";

export interface ExamMaster {
  exam: ExamInfo;
  domains: { code: string; name: string; weight: number }[];
  /** 本番の出題数。公開中でない資格は null */
  officialQuestionCount: number | null;
}

/** 資格マスタから、検査に使う資格の情報と分野を読む。資格がなければ null */
export function loadExam(config: Config, rootDir: string, examCode: string): ExamMaster | null {
  const parsed = ExamsFileSchema.safeParse(JSON.parse(readFileSync(resolve(rootDir, config.examsFile), "utf8")));
  if (!parsed.success) throw new LedgerError(["(資格マスタ)"]);
  const exam = parsed.data.exams.find((e) => e.examCode === examCode);
  if (!exam) return null;
  const edition = "edition" in exam ? exam.edition : undefined;
  const domains = "domains" in exam ? exam.domains : [];
  return {
    exam: { examCode: exam.examCode, vendor: exam.vendor, ...(edition !== undefined ? { edition } : {}) },
    domains,
    officialQuestionCount: "officialQuestionCount" in exam ? exam.officialQuestionCount : null,
  };
}

export type ProductionMaster = ExamMaster & { officialQuestionCount: number };
export type ExamPreamble<M extends ExamMaster = ExamMaster> = { ok: true; master: M } | { ok: false; exit: ExitCode };

/**
 * 各コマンドの前置き: 資格コードの形を検査し、資格マスタを読み、なければ入力の誤りとして報告する。
 * `production` を指定すると、本番の出題数と分野を持つ(公開中の)資格だけを通す。入力した文字列は出さない。
 */
export function prepareExam(
  input: { config: Config; rootDir: string; examCode: string; output: Output },
  condition: { production: true },
): ExamPreamble<ProductionMaster>;
export function prepareExam(
  input: { config: Config; rootDir: string; examCode: string; output: Output },
  condition?: { production: boolean },
): ExamPreamble;
export function prepareExam(
  input: { config: Config; rootDir: string; examCode: string; output: Output },
  condition: { production: boolean } = { production: false },
): ExamPreamble {
  const { config, rootDir, examCode, output } = input;
  if (!EXAM_CODE.test(examCode)) {
    report(output, "入力の誤り", "資格コードの形");
    return { ok: false, exit: EXIT.inputError };
  }
  let master: ExamMaster | null;
  try {
    master = loadExam(config, rootDir, examCode);
  } catch {
    report(output, "資格マスタの誤り", config.examsFile);
    return { ok: false, exit: EXIT.inputError };
  }
  if (master === null) {
    report(output, "入力の誤り", "資格マスタにない資格コード");
    return { ok: false, exit: EXIT.inputError };
  }
  if (condition.production && (master.officialQuestionCount === null || master.domains.length === 0)) {
    report(output, "入力の誤り", "公開中の資格ではない");
    return { ok: false, exit: EXIT.inputError };
  }
  return { ok: true, master };
}
