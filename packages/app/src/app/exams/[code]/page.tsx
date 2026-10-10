import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModeSelect } from "@/components/mode-select.tsx";
import { findPublishedExam, listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;

export function generateStaticParams() {
  return listPublishedExams().map((exam) => ({ code: exam.examCode }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const exam = findPublishedExam(code);
  return { title: exam ? `${exam.shortName}のモード選択` : "モード選択" };
}

export default async function ExamPage({ params }: Props) {
  const { code } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  const questions = await loadQuestions(exam);

  return (
    <ModeSelect
      exam={exam}
      // 選択に必要な情報だけを渡す(問題の本文や正解は、出題画面で読み込む)
      pool={questions.map((q) => ({
        questionId: q.questionId,
        domain: q.domain,
        choiceKeys: q.choices.map((c) => c.key),
      }))}
    />
  );
}
