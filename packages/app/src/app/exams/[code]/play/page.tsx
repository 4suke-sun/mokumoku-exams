import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlayLoader } from "@/components/play-loader.tsx";
import { findPublishedExam, listPublishedExams } from "@/lib/exam-data.ts";

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
  // 問題は、出題の画面を開いたあとに、出題中の分だけを取る(資格の全問を、画面の応答に入れない)
  return <PlayLoader exam={exam} />;
}
