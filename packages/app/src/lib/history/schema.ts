import { z } from "zod";
import {
  checkPerQuestionLengths,
  MAX_TEXT_ANSWER_LENGTH,
  ResultBaseSchema,
  SectionProgressSchema,
} from "@/lib/storage.ts";
import { isValidDate } from "@/lib/study-days.ts";

/** 資格コード(data/exams.json と同じ形)。DynamoDB のキーに使うため、区切りの `#` などを含められない。 */
export const EXAM_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,15}$/;

/** 問題 ID は `<資格コード>-<4 桁の連番>`(docs/data-spec.md)。 */
export const QUESTION_ID_PATTERN = /^[A-Z][A-Z0-9]{1,15}-\d{4}$/;

/** 選択肢のキー。1 つの問題の選択肢は 10 個までなので、A から J。 */
const CHOICE_KEY_PATTERN = /^[A-J]$/;

/** API で受け付ける結果の上限(DynamoDB の 1 項目の上限 400KB を超えないように、リクエストの大きさを抑える) */
export const MAX_BODY_BYTES = 100_000;

/** 完了時刻の下限。これより古い時刻は、正しい結果とみなさない。 */
export const EARLIEST_FINISHED_AT = "2020-01-01T00:00:00.000Z";

/** 完了時刻が、サーバーの時刻より先でよい幅。端末の時計のずれを許し、未来すぎる時刻を断る。 */
export const CLOCK_SKEW_MS = 24 * 60 * 60 * 1000;

const unique = (values: readonly string[]) => new Set(values).size === values.length;
const choiceKeys = z.array(z.string().regex(CHOICE_KEY_PATTERN)).max(10).refine(unique, "重複があります。");
const questionKey = z.string().max(64);

/**
 * 保存する結果。端末に保存する形(`ResultSchema`)に、サーバー側の条件を足す。
 * - 資格コードは決まった形。完了時刻はミリ秒つきの ISO 8601(ソートキーに使うため、文字の並びが時刻の並びと一致する形)で、
 *   下限と、サーバーの時刻から先への幅の中にある。
 * - 問題 ID は `<資格コード>-<4 桁>` の形で、重複せず、この資格のもの。
 * - 回答・自由記述の回答・選択肢の並びは、出題した問題についてのものだけで、選択肢のキーは重複しない。
 *   自由記述の回答は、`MAX_TEXT_ANSWER_LENGTH` 文字まで。
 * - 問題ごとの回答時間・自信なし・見直しは任意で、持つときは、出題した問題の数と同じ長さ。
 * 利用者の識別子(`sub`)は、ここに含められない(未知の項目として断る)。
 * 検査の指摘に、入力の値は含めない(場所と種類だけ)。
 */
export function apiResultSchema(nowMs: number) {
  const latest = nowMs + CLOCK_SKEW_MS;
  return ResultBaseSchema.extend({
    examCode: z.string().regex(EXAM_CODE_PATTERN),
    finishedAt: z.iso
      .datetime({ precision: 3 })
      .refine((value) => value >= EARLIEST_FINISHED_AT && Date.parse(value) <= latest, "時刻が範囲の外です。"),
    questionIds: z
      .array(z.string().regex(QUESTION_ID_PATTERN))
      .min(1)
      .max(500)
      .refine(unique, "問題 ID に重複があります。"),
    answers: z.record(questionKey, choiceKeys),
    textAnswers: z.record(questionKey, z.string().max(MAX_TEXT_ANSWER_LENGTH)).optional(),
    choiceOrder: z.record(questionKey, choiceKeys).optional(),
  }).superRefine((result, ctx) => {
    checkPerQuestionLengths(result, ctx);
    const asked = new Set(result.questionIds);
    const prefix = `${result.examCode}-`;
    result.questionIds.forEach((id, index) => {
      if (!id.startsWith(prefix)) {
        ctx.addIssue({ code: "custom", path: ["questionIds", index], message: "資格コードと合いません。" });
      }
    });
    for (const field of ["answers", "textAnswers", "choiceOrder"] as const) {
      for (const id of Object.keys(result[field] ?? {})) {
        if (!asked.has(id)) ctx.addIssue({ code: "custom", path: [field], message: "出題にない問題です。" });
      }
    }
  });
}

/** 復習の問題に、連続でこの回数だけ正解したら、マスターにする(画面とサーバーで同じ値を使う) */
export const MASTER_STREAK = 2;

export const ListQuerySchema = z.strictObject({ examCode: z.string().regex(EXAM_CODE_PATTERN) });

/** 完了時刻(ミリ秒つきの ISO 8601。結果のキーの一部) */
const FINISHED_AT = z.iso.datetime({ precision: 3 });

/** 結果の一覧の問い合わせ。`before` を渡すと、その完了時刻より古いものを返す(ページ分け) */
export const ResultsQuerySchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE_PATTERN),
  before: FINISHED_AT.optional(),
});

/** 1 回分の結果の問い合わせ */
export const ResultQuerySchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE_PATTERN),
  finishedAt: FINISHED_AT,
});

/** 問い合わせを持たない取得(資格をまたぐ一覧) */
export const EmptyQuerySchema = z.strictObject({});

/** 復習から手で外す本文。問題 ID は、この資格のもの */
export const ReviewRemovalSchema = z
  .strictObject({
    examCode: z.string().regex(EXAM_CODE_PATTERN),
    questionId: z.string().regex(QUESTION_ID_PATTERN),
  })
  .refine((change) => change.questionId.startsWith(`${change.examCode}-`), "資格コードと合いません。");

/** 復習から外す本文の上限(資格コードと問題 ID だけなので、小さい) */
export const MAX_REVIEW_BODY_BYTES = 1_000;

/** ブックマークの変更の本文の上限(問題 ID と資格コードだけなので、小さい) */
export const MAX_BOOKMARK_BODY_BYTES = 1_000;

/** ブックマークを付ける・外す。問題 ID は、この資格のもの。 */
export const BookmarkChangeSchema = z
  .strictObject({
    examCode: z.string().regex(EXAM_CODE_PATTERN),
    questionId: z.string().regex(QUESTION_ID_PATTERN),
    bookmarked: z.boolean(),
  })
  .refine((change) => change.questionId.startsWith(`${change.examCode}-`), "資格コードと合いません。");

/** 目標日の変更の本文の上限(資格コードと日付だけなので、小さい) */
export const MAX_GOAL_BODY_BYTES = 1_000;

/** 目標日として受け付ける範囲 */
export const EARLIEST_GOAL_DATE = "2020-01-01";
export const LATEST_GOAL_DATE = "2099-12-31";

/** 目標日を決める・消す。日付は実在する `YYYY-MM-DD` で、範囲の中。null で消す。 */
export const GoalChangeSchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE_PATTERN),
  date: z
    .string()
    .refine(
      (date) => isValidDate(date) && date >= EARLIEST_GOAL_DATE && date <= LATEST_GOAL_DATE,
      "日付が正しくありません。",
    )
    .nullable(),
});

/** セクションの進捗の取り込みの本文の上限(最大 1000 セクションの記録を含められる) */
export const MAX_SECTIONS_BODY_BYTES = 200_000;

/** セクションの進捗を取り込む。端末に保存する形(`SectionProgressSchema`)に、資格コードの形の条件を足す。 */
export const SectionsChangeSchema = SectionProgressSchema.refine(
  (progress) => EXAM_CODE_PATTERN.test(progress.examCode),
  "資格コードが正しくありません。",
);
