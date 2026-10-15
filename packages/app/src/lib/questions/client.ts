import { z } from "zod";
import { requestJson } from "@/lib/api/client.ts";
import type { Question } from "@/lib/types.ts";

// 中身の形は、サーバーが問題データの検査(validate:data)を通したもの。ここでは、問題の配列であることと ID だけを確かめる
const QuestionsSchema = z.object({
  questions: z.array(z.looseObject({ questionId: z.string() })).max(1000),
});

/** 問題 ID を指定して、問題を取る。取れなければ null。並びは指定の順で、いまのデータにない問題は入らない。 */
export async function fetchQuestions(examCode: string, questionIds: readonly string[]): Promise<Question[] | null> {
  if (questionIds.length === 0) return [];
  const result = await requestJson("/api/questions", {
    method: "POST",
    body: { examCode, questionIds },
    schema: QuestionsSchema,
  });
  return result.ok ? (result.data.questions as unknown as Question[]) : null;
}
