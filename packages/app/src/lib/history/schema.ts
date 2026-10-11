import { z } from "zod";
import { ResultSchema } from "@/lib/storage.ts";

/** 資格コード(data/exams.json と同じ形)。DynamoDB のキーに使うため、区切りの `#` などを含められない。 */
export const EXAM_CODE_PATTERN = /^[A-Z][A-Z0-9]{1,15}$/;

/** API で受け付ける結果の上限(DynamoDB の 1 項目の上限 400KB を超えないように、リクエストの大きさを抑える) */
export const MAX_BODY_BYTES = 100_000;

/**
 * 保存する結果。端末に保存する形(`ResultSchema`)に、サーバー側の条件を足す:
 * 資格コードは決まった形、完了時刻はミリ秒つきの ISO 8601(`toISOString()` の形。ソートキーに使うため、文字の並びが時刻の並びと一致する形に限る)。
 * 利用者の識別子(`sub`)は、ここに含められない(未知の項目として断る)。
 */
export const ApiResultSchema = ResultSchema.extend({
  examCode: z.string().regex(EXAM_CODE_PATTERN),
  finishedAt: z.iso.datetime({ precision: 3 }),
  questionIds: z.array(z.string().max(64)).min(1).max(500),
});

export const ListQuerySchema = z.strictObject({ examCode: z.string().regex(EXAM_CODE_PATTERN) });
