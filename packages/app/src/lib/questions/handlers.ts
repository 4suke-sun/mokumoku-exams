import { EXAM_CODE, QUESTION_ID } from "@mokumoku-exams/data-schema/exam-data/shape";
import { z } from "zod";
import { acceptBody, fail, unavailable } from "@/lib/api/endpoint.ts";
import type { GuardDeps } from "@/lib/auth/guard.ts";
import { json } from "@/lib/auth/handlers.ts";
import type { Question } from "@/lib/types.ts";

/** 1 回に取れる問題の数の上限(出題の状態が持てる問題の数の上限と同じ。lib/storage.ts の SessionSchema) */
export const MAX_QUESTIONS_PER_REQUEST = 1000;
/** 本文の上限。問題 ID が上限の数でも収まる大きさ */
export const MAX_QUESTIONS_BODY_BYTES = 32 * 1024;

export const QuestionsRequestSchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE),
  questionIds: z.array(z.string().regex(QUESTION_ID)).min(1).max(MAX_QUESTIONS_PER_REQUEST),
});

export type QuestionsDeps = {
  auth: GuardDeps;
  /** 公開中の資格の問題。公開中でなければ null */
  questions: (examCode: string) => Promise<readonly Question[] | null>;
};

/**
 * 問題 ID を指定して、公開中の資格の問題(正解と解説を含む)を返す。ログインした利用者だけが取れる
 * (問題と正解は、ログインなしで開ける経路に置かない)。画面は、開いたあとに、表示に要る問題だけを取る。
 * 返すのは、いまのデータにある問題だけで、並びは指定の順。公開中でない資格は 400。
 */
export async function handleGetQuestions(request: Request, deps: QuestionsDeps): Promise<Response> {
  const accepted = await acceptBody(request, deps, {
    access: "user",
    maxBytes: MAX_QUESTIONS_BODY_BYTES,
    body: QuestionsRequestSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body } = accepted;
  try {
    const all = await deps.questions(body.examCode);
    if (!all) return fail("bad-request", 400, auth.setCookies);
    const byId = new Map(all.map((q) => [q.questionId, q]));
    const questions = [...new Set(body.questionIds)].flatMap((id) => byId.get(id) ?? []);
    return json({ questions }, 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
  }
}
