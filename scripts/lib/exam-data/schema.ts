/**
 * 資格マスタ(data/exams.json)と問題データ(data/questions.<コード>.json)のスキーマ。
 * 仕様は docs/data-spec.md。項目の形と、1 つの問題の中の整合を、ここで検査する。
 * ファイルをまたぐ検査(分野がマスタにあるか、ファイルの有無)は、validate.ts で行う。
 *
 * 検査メッセージに入力の値を含めない(場所と種類だけ)。custom のメッセージは、固定の文言にする。
 */
import { z } from "zod";

/** 空白だけではない文字列。 */
const text = z.string().regex(/\S/, "空白だけの文字列です");

const EXAM_CODE = /^[A-Z][A-Z0-9]{1,15}$/;
const DOMAIN_CODE = /^domain\d{1,2}$/;

/** 比較用に、全角・半角、空白の違いをならす。 */
export function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/\s+/g, " ").trim();
}

// ---- 資格マスタ ----

export const DomainSchema = z.strictObject({
  code: z.string().regex(DOMAIN_CODE),
  name: text,
  weight: z.number().min(0).max(1),
});

const examBase = {
  examCode: z.string().regex(EXAM_CODE),
  vendor: text,
  name: text,
  shortName: text,
};

/** 公開中の資格: 出題に必要な情報がすべてそろっている。 */
export const PublishedExamSchema = z
  .strictObject({
    ...examBase,
    status: z.literal("published"),
    edition: text,
    category: text,
    passingScore: z.number().positive(),
    totalScore: z.number().positive(),
    officialQuestionCount: z.int().positive(),
    officialTimeMinutes: z.int().positive(),
    domains: z.array(DomainSchema).min(1),
  })
  .superRefine((exam, ctx) => {
    if (exam.passingScore > exam.totalScore) {
      ctx.addIssue({ code: "custom", path: ["passingScore"], message: "合格点が満点を超えています" });
    }
    const codes = exam.domains.map((d) => d.code);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: "custom", path: ["domains"], message: "分野のコードが重複しています" });
    }
    const total = exam.domains.reduce((sum, d) => sum + d.weight, 0);
    if (Math.abs(total - 1) > 0.005) {
      ctx.addIssue({
        code: "custom",
        path: ["domains"],
        message: "分野の重みの合計が 1 ではありません(許容誤差 0.005)",
      });
    }
  });

/** 近日公開の資格: 一覧に表示するための最小限の情報だけを持つ。問題データは持たない。 */
export const ComingSoonExamSchema = z.strictObject({
  ...examBase,
  status: z.literal("coming-soon"),
  note: text.optional(),
});

export const ExamSchema = z.discriminatedUnion("status", [PublishedExamSchema, ComingSoonExamSchema]);

export const ExamsFileSchema = z.strictObject({ exams: z.array(ExamSchema).min(1) }).superRefine((file, ctx) => {
  const seen = new Set<string>();
  file.exams.forEach((exam, i) => {
    if (seen.has(exam.examCode)) {
      ctx.addIssue({ code: "custom", path: ["exams", i, "examCode"], message: "資格のコードが重複しています" });
    }
    seen.add(exam.examCode);
  });
});

// ---- 問題データ ----

const ChoiceSchema = z.strictObject({
  key: z.string().regex(/^[A-Z]$/),
  text,
  explanation: text.optional(),
});

const ReferenceSchema = z.strictObject({
  title: text,
  url: z.string().regex(/^https?:\/\/\S+$/, "http(s) で始まる URL ではありません"),
});

export const QuestionSchema = z
  .strictObject({
    questionId: z.string().regex(/^[A-Z][A-Z0-9]{1,15}-\d{4}$/),
    examCode: z.string().regex(EXAM_CODE),
    domain: z.string().regex(DOMAIN_CODE),
    questionType: z.enum(["single", "multiple"]),
    difficulty: z.enum(["easy", "medium", "hard"]).optional(),
    questionText: text,
    choices: z.array(ChoiceSchema).min(2).max(10),
    correctAnswers: z.array(z.string()).min(1),
    explanation: text,
    supplement: text.optional(),
    references: z.array(ReferenceSchema).optional(),
    tags: z.array(text).optional(),
  })
  .superRefine((q, ctx) => {
    const keys = q.choices.map((c) => c.key);
    const sequential = keys.every((key, i) => key === String.fromCharCode(65 + i));
    if (!sequential) {
      ctx.addIssue({ code: "custom", path: ["choices"], message: "選択肢のキーが A から連番になっていません" });
    }
    const answers = new Set(q.correctAnswers);
    if (answers.size !== q.correctAnswers.length) {
      ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: "正解が重複しています" });
    }
    if (![...answers].every((a) => keys.includes(a))) {
      ctx.addIssue({ code: "custom", path: ["correctAnswers"], message: "正解が選択肢のキーにありません" });
    }
    if (q.questionType !== (answers.size === 1 ? "single" : "multiple")) {
      ctx.addIssue({ code: "custom", path: ["questionType"], message: "問題の種類が正解の数と一致しません" });
    }
    const texts = q.choices.map((c) => normalizeText(c.text));
    if (new Set(texts).size !== texts.length) {
      ctx.addIssue({ code: "custom", path: ["choices"], message: "同じ文言の選択肢があります" });
    }
  });

export const QuestionsFileSchema = z
  .strictObject({
    examCode: z.string().regex(EXAM_CODE),
    questions: z.array(QuestionSchema).min(1),
  })
  .superRefine((file, ctx) => {
    const ids = new Set<string>();
    const stems = new Set<string>();
    file.questions.forEach((q, i) => {
      if (ids.has(q.questionId)) {
        ctx.addIssue({ code: "custom", path: ["questions", i, "questionId"], message: "問題の ID が重複しています" });
      }
      ids.add(q.questionId);
      if (q.examCode !== file.examCode) {
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "examCode"],
          message: "ファイルの資格コードと一致しません",
        });
      }
      if (!q.questionId.startsWith(`${file.examCode}-`)) {
        ctx.addIssue({
          code: "custom",
          path: ["questions", i, "questionId"],
          message: "ID の接頭辞が資格コードと一致しません",
        });
      }
      const stem = normalizeText(q.questionText);
      if (stems.has(stem)) {
        ctx.addIssue({ code: "custom", path: ["questions", i, "questionText"], message: "同じ設問文の問題があります" });
      }
      stems.add(stem);
    });
  });

export type Exam = z.infer<typeof ExamSchema>;
export type PublishedExam = z.infer<typeof PublishedExamSchema>;
export type ExamsFile = z.infer<typeof ExamsFileSchema>;
export type Question = z.infer<typeof QuestionSchema>;
export type QuestionsFile = z.infer<typeof QuestionsFileSchema>;
