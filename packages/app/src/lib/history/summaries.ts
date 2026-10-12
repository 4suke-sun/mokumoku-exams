import { type DashboardSummary, type ScoredQuestion, summarize } from "@/lib/dashboard.ts";
import { fetchDays } from "@/lib/history/client.ts";
import { loadExamResults } from "@/lib/history/load.ts";
import { mergeDays, type StudyDay } from "@/lib/study-days.ts";
import type { PublishedExam } from "@/lib/types.ts";

/** 資格をまたぐ画面に渡す、資格と、集計に使う問題の情報 */
export type ExamEntry = { exam: PublishedExam; questions: ScoredQuestion[] };

export type ExamSummary = { entry: ExamEntry; summary: DashboardSummary; source: "server" | "local" };

/** 資格ごとの学習の状況。結果の数え方は、資格ごとのダッシュボードと同じ。 */
export async function loadSummaries(entries: readonly ExamEntry[]): Promise<ExamSummary[]> {
  return Promise.all(
    entries.map(async (entry) => {
      const { results, source } = await loadExamResults(entry.exam.examCode);
      return { entry, summary: summarize(results, entry.questions, entry.exam), source };
    }),
  );
}

/** 全資格の日ごとの学習量を、日付ごとに足したもの。どれかが取得できなければ null(一部だけの値を、全体として見せない)。 */
export async function loadAllDays(entries: readonly ExamEntry[]): Promise<StudyDay[] | null> {
  const lists = await Promise.all(entries.map(({ exam }) => fetchDays(exam.examCode)));
  return lists.every((list): list is StudyDay[] => list !== null) ? mergeDays(lists) : null;
}
