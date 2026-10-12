import type { Metadata } from "next";
import { AchievementsView } from "@/components/achievements-view.tsx";
import { toScored } from "@/lib/dashboard.ts";
import { listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";

export const metadata: Metadata = { title: "実績" };

export default async function AchievementsPage() {
  // 集計に要る情報(正解と分野)だけを渡す。問題の本文や解説は、画面へ送らない
  const entries = await Promise.all(
    listPublishedExams().map(async (exam) => ({ exam, questions: (await loadQuestions(exam)).map(toScored) })),
  );

  return <AchievementsView entries={entries} />;
}
