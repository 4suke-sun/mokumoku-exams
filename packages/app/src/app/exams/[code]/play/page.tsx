import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Player } from "@/components/player.tsx";
import { findPublishedExam, listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;
export const metadata: Metadata = { title: "出題" };

export function generateStaticParams() {
  return listPublishedExams().map((exam) => ({ code: exam.examCode }));
}

export default async function PlayPage({ params }: Props) {
  const { code } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  const questions = await loadQuestions(exam);

  return <Player exam={exam} questions={questions} />;
}
