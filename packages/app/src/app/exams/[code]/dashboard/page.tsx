import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DashboardView } from "@/components/dashboard-view.tsx";
import { toScored } from "@/lib/dashboard.ts";
import { findPublishedExam, listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;
export const metadata: Metadata = { title: "学習の状況" };

export function generateStaticParams() {
  return listPublishedExams().map((exam) => ({ code: exam.examCode }));
}

export default async function DashboardPage({ params }: Props) {
  const { code } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  // 集計に使う項目だけを渡す(問題の本文や解説は、画面の応答に入れない)
  const questions = (await loadQuestions(exam)).map(toScored);

  return <DashboardView exam={exam} questions={questions} />;
}
