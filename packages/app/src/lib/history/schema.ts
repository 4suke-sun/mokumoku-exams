import { z } from "zod";
import { ResultSchema } from "@/lib/storage.ts";

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
 * - 回答と選択肢の並びは、出題した問題についてのものだけで、選択肢のキーは重複しない。
 * 利用者の識別子(`sub`)は、ここに含められない(未知の項目として断る)。
 * 検査の指摘に、入力の値は含めない(場所と種類だけ)。
 */
export function apiResultSchema(nowMs: number) {
  const latest = nowMs + CLOCK_SKEW_MS;
  return ResultSchema.extend({
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
    choiceOrder: z.record(questionKey, choiceKeys).optional(),
  }).superRefine((result, ctx) => {
    const asked = new Set(result.questionIds);
    const prefix = `${result.examCode}-`;
    result.questionIds.forEach((id, index) => {
      if (!id.startsWith(prefix)) {
        ctx.addIssue({ code: "custom", path: ["questionIds", index], message: "資格コードと合いません。" });
      }
    });
    for (const field of ["answers", "choiceOrder"] as const) {
      for (const id of Object.keys(result[field] ?? {})) {
        if (!asked.has(id)) ctx.addIssue({ code: "custom", path: [field], message: "出題にない問題です。" });
      }
    }
  });
}

export const ListQuerySchema = z.strictObject({ examCode: z.string().regex(EXAM_CODE_PATTERN) });
