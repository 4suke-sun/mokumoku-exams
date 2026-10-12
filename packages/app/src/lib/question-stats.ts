import { isQuestionCorrect } from "./quiz.ts";
import type { Result } from "./storage.ts";
import type { Question } from "./types.ts";

/** 問題ごとに見せる直近の正誤の数 */
export const RECENT_STAT_LIMIT = 5;

/** 問題ごとの解答回数と、直近の正誤(古い順。true が正解) */
export type QuestionStatView = { count: number; recent: boolean[] };

/**
 * この端末に残した結果から、問題ごとの解答回数と直近の正誤を数える(アカウントの集計を取れないときの代わり)。
 * 正誤は、いまの問題データで採点し直す。いまのデータにない問題は含めない。同じ結果の中の同じ問題は、1 回として数える。
 */
export function statsFromResults(
  results: readonly Result[],
  questions: readonly Question[],
): Map<string, QuestionStatView> {
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const stats = new Map<string, QuestionStatView>();
  // 古い順に足していき、直近の正誤は最後の `RECENT_STAT_LIMIT` 回を残す
  const ordered = [...results].sort((a, b) => (a.finishedAt < b.finishedAt ? -1 : a.finishedAt > b.finishedAt ? 1 : 0));
  for (const result of ordered) {
    for (const id of new Set(result.questionIds)) {
      const question = byId.get(id);
      if (!question) continue;
      const stat = stats.get(id) ?? { count: 0, recent: [] };
      const correct = isQuestionCorrect(question, result.answers, result.textAnswers);
      stats.set(id, { count: stat.count + 1, recent: [...stat.recent, correct].slice(-RECENT_STAT_LIMIT) });
    }
  }
  return stats;
}

/** 直近の正誤の表示(古い順、右が最新)。足りない分は、左を「-」で埋める */
export type RecentMark = "o" | "x" | "-";

export function recentMarks(recent: readonly boolean[], limit: number = RECENT_STAT_LIMIT): RecentMark[] {
  const shown = recent.slice(-limit).map((ok): RecentMark => (ok ? "o" : "x"));
  const blank: RecentMark[] = Array.from({ length: limit - shown.length }, () => "-");
  return [...blank, ...shown];
}
