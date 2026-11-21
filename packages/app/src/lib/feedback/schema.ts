import { EXAM_CODE, QUESTION_ID } from "@mokumoku-exams/data-schema/exam-data/shape";
import { z } from "zod";

// 送信フォーム(お問い合わせ・問題の誤りの報告)の入力の形。仕様は docs/app/specs/feedback.md。

/** 自由記述の長さの上限(前後の空白を除いて数える) */
export const MAX_FEEDBACK_TEXT_LENGTH = 2000;
/** 1 人あたり、1 日(日本時間の日付)に送れる件数。2 つのフォームを合わせて数える */
export const DAILY_FEEDBACK_LIMIT = 10;
/** 本文の大きさの上限。自由記述が上限の長さ(日本語は 1 文字 3 バイト)でも収まる大きさ */
export const MAX_FEEDBACK_BODY_BYTES = 16 * 1024;

/** お問い合わせの種類と、画面・Issue の題に出す名前 */
export const CONTACT_CATEGORIES = {
  bug: "不具合",
  improvement: "機能改善の要望",
  feature: "機能追加の要望",
  other: "その他",
} as const;

/** 問題の誤りの種類と、画面・Issue の題に出す名前 */
export const QUESTION_CATEGORIES = {
  answer: "正解が違う",
  explanation: "解説が違う",
  unclear: "問題文・選択肢が分かりにくい",
  other: "その他",
} as const;

export type ContactCategory = keyof typeof CONTACT_CATEGORIES;
export type QuestionCategory = keyof typeof QUESTION_CATEGORIES;

const keysOf = <T extends Record<string, string>>(record: T) => Object.keys(record) as [keyof T & string];

const trimmedLength = (min: number) =>
  z.string().refine((text) => {
    const length = [...text.trim()].length;
    return length >= min && length <= MAX_FEEDBACK_TEXT_LENGTH;
  });

export const FeedbackRequestSchema = z.discriminatedUnion("form", [
  z.strictObject({
    form: z.literal("contact"),
    category: z.enum(keysOf(CONTACT_CATEGORIES)),
    text: trimmedLength(1),
    /** 試験の画面から開いたときだけ送る、対象の試験の資格コード(公開中の資格に実在することは、サーバーで確かめる) */
    examCode: z.string().regex(EXAM_CODE).optional(),
  }),
  z.strictObject({
    form: z.literal("question"),
    category: z.enum(keysOf(QUESTION_CATEGORIES)),
    text: trimmedLength(0),
    examCode: z.string().regex(EXAM_CODE),
    questionId: z.string().regex(QUESTION_ID),
  }),
]);

export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;
