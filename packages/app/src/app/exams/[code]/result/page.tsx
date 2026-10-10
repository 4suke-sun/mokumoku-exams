import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResultView } from "@/components/result-view.tsx";
import { findPublishedExam, listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;
export const metadata: Metadata = { title: "結果" };

export function generateStaticParams() {
  return listPublishedExams().map((exam) => ({ code: exam.examCode }));
}

export default async function ResultPage({ params }: Props) {
  const { code } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  const questions = await loadQuestions(exam);

  return <ResultView exam={exam} questions={questions} />;
}
