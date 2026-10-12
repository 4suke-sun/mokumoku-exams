import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ExamInfo } from "@/components/exam-info.tsx";
import { loadCurriculum } from "@/lib/curriculum-data.ts";
import { findPublishedExam, listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return listPublishedExams().map((exam) => ({ code: exam.examCode }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const exam = findPublishedExam(code);
  return { title: exam ? `${exam.shortName}の試験の情報` : "試験の情報" };
}

export default async function ExamInfoPage({ params }: Props) {
  const { code } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  const [questions, units] = await Promise.all([loadQuestions(exam), loadCurriculum(exam)]);

  return (
    <ExamInfo
      exam={exam}
      questionCount={questions.length}
      choiceCount={questions.filter((q) => q.questionType !== "free-text").length}
      unitCount={units?.length ?? null}
    />
  );
}
