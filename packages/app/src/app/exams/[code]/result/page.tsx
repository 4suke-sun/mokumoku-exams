import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ResultView } from "@/components/result-view.tsx";
import { toOutline } from "@/lib/dashboard.ts";
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
  // 問題の本文と解説は、結果の画面を開いたあとに、詳しく出す回の分だけを取る
  const outline = (await loadQuestions(exam)).map(toOutline);

  return <ResultView exam={exam} outline={outline} />;
}
