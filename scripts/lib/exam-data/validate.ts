/**
 * 資格マスタと問題データ全体の検査: 各ファイルのスキーマ検査と、ファイルをまたぐ整合の検査。
 * 純粋な関数にして単体テストする(ファイルの読み込みは scripts/validate-exam-data.ts)。
 * 報告は、場所(ファイル、項目の位置、問題の ID)と種類だけにする。入力の値は含めない。
 */
import type { ZodError } from "zod";
import type { PublishedExam } from "./schema.ts";
import { ExamsFileSchema, QuestionsFileSchema, VendorsFileSchema } from "./schema.ts";

export interface DataFile {
  name: string;
  data: unknown;
}

export const EXAMS_FILE = "exams.json";
export const VENDORS_FILE = "vendors.json";
const QUESTIONS_FILE = /^questions\.([a-z][a-z0-9]{1,5}-[a-z][a-z0-9]{1,9}-[a-z0-9]{2,4})\.json$/;
const QUESTION_ID = /^[A-Z][A-Z0-9]{1,15}-\d{4}$/;

const KIND: Record<string, string> = {
  invalid_type: "型が違います",
  invalid_value: "許可されていない値です",
  invalid_format: "形式が違います",
  too_small: "少なすぎる(短い・小さい)値です",
  too_big: "多すぎる(長い・大きい)値です",
  unrecognized_keys: "未知の項目があります",
  invalid_union: "どの形にも合いません",
  invalid_key: "キーが不正です",
  invalid_element: "要素が不正です",
  not_multiple_of: "倍数ではありません",
};

function formatPath(path: PropertyKey[]): string {
  if (path.length === 0) return "(ルート)";
  return path.map((p, i) => (typeof p === "number" ? `[${p}]` : i === 0 ? String(p) : `.${String(p)}`)).join("");
}

/** 問題の位置(questions[i])から、問題の ID を取り出す(ID の形のときだけ)。 */
function questionIdAt(data: unknown, path: PropertyKey[]): string | null {
  if (path[0] !== "questions" || typeof path[1] !== "number") return null;
  const questions = (data as { questions?: unknown } | null)?.questions;
  if (!Array.isArray(questions)) return null;
  const id = (questions[path[1]] as { questionId?: unknown } | undefined)?.questionId;
  return typeof id === "string" && QUESTION_ID.test(id) ? id : null;
}

/** Zod の検査結果を、場所と種類だけの文字列にする。 */
export function formatIssues(file: string, error: ZodError, data: unknown): string[] {
  return error.issues.map((issue) => {
    const id = questionIdAt(data, issue.path);
    const kind = issue.code === "custom" ? issue.message : (KIND[issue.code] ?? `検査に合いません(${issue.code})`);
    return `${file}: ${formatPath(issue.path)}${id ? `(${id})` : ""}: ${kind}`;
  });
}

/**
 * データ全体を検査する。
 * - exams: 資格マスタ(無ければ null)
 * - questionFiles: questions.<コード>.json の一覧
 * - vendors: ベンダーの略称の一覧(vendors.json)。資格のベンダーと試験コードの先頭が一致するかを検査する
 */
export function validateDataSet(exams: unknown | null, questionFiles: DataFile[], vendors?: unknown | null): string[] {
  const errors: string[] = [];

  if (exams === null) {
    errors.push(`${EXAMS_FILE}: ファイルがありません`);
    return errors;
  }
  const parsedExams = ExamsFileSchema.safeParse(exams);
  if (!parsedExams.success) {
    errors.push(...formatIssues(EXAMS_FILE, parsedExams.error, exams));
    return errors;
  }

  const parsedVendors = VendorsFileSchema.safeParse(vendors);
  if (vendors === undefined) {
    // ベンダーの略称の検査は、一覧が渡されたときだけ行う
  } else if (!parsedVendors.success) {
    errors.push(
      ...(vendors === null
        ? [`${VENDORS_FILE}: ファイルがありません`]
        : formatIssues(VENDORS_FILE, parsedVendors.error, vendors)),
    );
  } else {
    const abbrs = new Map(parsedVendors.data.vendors.map((v) => [v.name, v.abbr]));
    parsedExams.data.exams.forEach((exam, i) => {
      const abbr = abbrs.get(exam.vendor);
      if (abbr === undefined) {
        errors.push(`${EXAMS_FILE}: exams[${i}].vendor: ${VENDORS_FILE} にないベンダーです`);
      } else if (!exam.examCode.startsWith(`${abbr}-`)) {
        errors.push(`${EXAMS_FILE}: exams[${i}].examCode: コードの先頭が、ベンダーの略称と一致しません`);
      }
    });
  }

  const byCode = new Map(parsedExams.data.exams.map((e) => [e.examCode, e]));
  const seenFiles = new Set<string>();

  for (const file of [...questionFiles].sort((a, b) => a.name.localeCompare(b.name))) {
    const match = QUESTIONS_FILE.exec(file.name);
    if (!match?.[1]) {
      errors.push(`${file.name}: ファイル名が questions.<コード(英小文字と数字)>.json の形ではありません`);
      continue;
    }
    const code = match[1].toUpperCase();
    seenFiles.add(code);

    const parsed = QuestionsFileSchema.safeParse(file.data);
    if (!parsed.success) {
      errors.push(...formatIssues(file.name, parsed.error, file.data));
      continue;
    }
    if (parsed.data.examCode !== code) {
      errors.push(`${file.name}: examCode がファイル名のコードと一致しません`);
    }

    const exam = byCode.get(code);
    if (!exam) {
      errors.push(`${file.name}: 資格マスタにない資格の問題データです`);
      continue;
    }
    if (exam.status !== "published") {
      errors.push(`${file.name}: 公開中ではない資格(近日公開)に問題データがあります`);
      continue;
    }
    errors.push(...checkAgainstExam(file.name, parsed.data.questions, exam));
  }

  parsedExams.data.exams.forEach((exam, i) => {
    if (exam.status === "published" && !seenFiles.has(exam.examCode)) {
      errors.push(
        `${EXAMS_FILE}: exams[${i}]: 公開中の資格に問題データのファイル(questions.${exam.examCode.toLowerCase()}.json)がありません`,
      );
    }
  });

  return errors;
}

/** 1 つの資格の問題を、資格マスタと照合する(分野の存在、本番モードの出題数)。 */
function checkAgainstExam(
  file: string,
  questions: { questionId: string; domain: string; questionType: string }[],
  exam: PublishedExam,
): string[] {
  const errors: string[] = [];
  const domains = new Set(exam.domains.map((d) => d.code));
  questions.forEach((q, i) => {
    if (!q.questionId.startsWith(`${exam.idPrefix}-`)) {
      errors.push(
        `${file}: questions[${i}](${q.questionId}).questionId: ID の接頭辞が、資格マスタの idPrefix と一致しません`,
      );
    }
    if (!domains.has(q.domain)) {
      errors.push(`${file}: questions[${i}](${q.questionId}).domain: 資格マスタにない分野です`);
    }
  });
  // 本番モードは、選択式の問題だけから出題する(自由記述は含めない)
  const choiceCount = questions.filter((q) => q.questionType !== "free-text").length;
  if (choiceCount < exam.officialQuestionCount) {
    errors.push(`${file}: 選択式の問題数が、本番モードの出題数(officialQuestionCount)に足りません`);
  }
  return errors;
}
