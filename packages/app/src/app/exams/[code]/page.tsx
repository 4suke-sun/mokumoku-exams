import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ModeSelect } from "@/components/mode-select.tsx";
import { loadCodeDrill, visibleProblems } from "@/lib/code-drill-data.ts";
import { loadCurriculum } from "@/lib/curriculum-data.ts";
import { findPublishedExam, listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";
import { loadNotebook, visibleEntries } from "@/lib/notebook-data.ts";
import { loadSummaryCards } from "@/lib/summary-data.ts";

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
  const [questions, units, summary, notebook, codeDrill] = await Promise.all([
    loadQuestions(exam),
    loadCurriculum(exam),
    loadSummaryCards(exam),
    loadNotebook(exam),
    loadCodeDrill(exam),
  ]);
  const codeDrillCount = codeDrill ? visibleProblems(codeDrill, false).length : 0;

  return (
    <ModeSelect
      exam={exam}
      // 選択に必要な情報だけを渡す(問題の本文や正解は、出題画面で読み込む)
      pool={questions.map((q) => ({
        questionId: q.questionId,
        domain: q.domain,
        questionType: q.questionType,
        difficulty: q.difficulty,
        choiceKeys: q.questionType === "free-text" ? [] : q.choices.map((c) => c.key),
      }))}
      studyUnits={units?.length ?? null}
      summaryCount={summary?.length ?? null}
      // 利用者に出すのは、検証済みの見出しだけ(数も同じ)
      notebookCount={notebook ? visibleEntries(notebook.entries, false).length : null}
      // 検証済みの問題が 1 つもない資格では、入口を出さない
      codeDrillCount={codeDrillCount > 0 ? codeDrillCount : null}
    />
  );
}
