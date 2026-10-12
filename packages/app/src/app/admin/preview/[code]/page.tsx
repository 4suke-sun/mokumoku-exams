import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { QuestionPreview } from "@/components/question-preview.tsx";
import { findPublishedExam, loadQuestions } from "@/lib/exam-data.ts";

type Props = { params: Promise<{ code: string }> };

export const metadata: Metadata = { title: "全問のプレビュー" };

/** 資格ごとの全問のプレビュー。管理者だけが開ける(`/admin` 以下の共通の枠が、管理者を確かめる)。 */
export default async function AdminPreviewPage({ params }: Props) {
  const { code } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  const questions = await loadQuestions(exam);
  return (
    <QuestionPreview exam={{ examCode: exam.examCode, name: exam.name, domains: exam.domains }} questions={questions} />
  );
}
