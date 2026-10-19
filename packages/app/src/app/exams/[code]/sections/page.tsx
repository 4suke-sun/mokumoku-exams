import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SectionPicker } from "@/components/section-picker.tsx";
import { findPublishedExam, listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";
import { sectionTargets } from "@/lib/sections.ts";

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;
export const metadata: Metadata = { title: "セクションで解く" };

export function generateStaticParams() {
  return listPublishedExams().map((exam) => ({ code: exam.examCode }));
}

export default async function SectionsPage({ params }: Props) {
  const { code } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  const questions = await loadQuestions(exam);

  return (
    <SectionPicker
      exam={exam}
      // 区切りに必要な情報だけを渡す(問題の本文や正解は、出題画面で読み込む)。自由記述は含めない
      items={sectionTargets(questions).map((q) => ({
        questionId: q.questionId,
        choiceKeys: q.choices.map((c) => c.key),
      }))}
    />
  );
}
