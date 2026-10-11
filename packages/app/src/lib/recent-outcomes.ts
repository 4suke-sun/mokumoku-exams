import { answerFor, isCorrect } from "./quiz.ts";
import type { Result } from "./storage.ts";
import type { Question } from "./types.ts";

/** 問題ごとに残す正誤の回数 */
export const RECENT_OUTCOMES = 5;

/**
 * 保存した結果(新しい順)から、問題ごとの直近の正誤(true が正解)を、新しい順に最大 `limit` 回まで返す。
 * 正誤は、いまの問題データで採点し直す。未回答は不正解。いまのデータにない問題は含めない。
 */
export function recentOutcomes(
  results: readonly Result[],
  questions: readonly Question[],
  limit: number = RECENT_OUTCOMES,
): Map<string, boolean[]> {
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const outcomes = new Map<string, boolean[]>();
  for (const result of results) {
    // 同じ結果の中に同じ問題が重なっていても、1 回として数える
    for (const id of new Set(result.questionIds)) {
      const question = byId.get(id);
      if (!question) continue;
      const list = outcomes.get(id) ?? [];
      if (list.length >= limit) continue;
      list.push(isCorrect(question, answerFor(result.answers, id)));
      outcomes.set(id, list);
    }
  }
  return outcomes;
}
