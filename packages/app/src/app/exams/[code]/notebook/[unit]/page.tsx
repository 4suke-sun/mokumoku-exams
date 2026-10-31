import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotebookUnitView } from "@/components/notebook-view.tsx";
import { listPublishedExams } from "@/lib/exam-data.ts";
import { loadNotebook, loadNotebookPage } from "@/lib/notebook-data.ts";

type Props = { params: Promise<{ code: string; unit: string }> };

export const dynamicParams = false;

export async function generateStaticParams() {
  const params = await Promise.all(
    listPublishedExams().map(async (exam) =>
      ((await loadNotebook(exam))?.units ?? []).map((unit) => ({ code: exam.examCode, unit: unit.id })),
    ),
  );
  return params.flat();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, unit: unitId } = await params;
  const unit = (await loadNotebookPage(code, false))?.units.find((u) => u.id === unitId);
  return { title: unit ? `${unit.title}(体系ノート)` : "体系ノート" };
}

/** 中分類のページ(利用者の画面。検証済みの見出しだけを出す) */
export default async function NotebookUnitPage({ params }: Props) {
  const { code, unit: unitId } = await params;
  const data = await loadNotebookPage(code, false);
  const unit = data?.units.find((u) => u.id === unitId);
  if (!data || !unit) notFound();
  return (
    <NotebookUnitView
      exam={data.exam}
      units={data.units}
      unit={unit}
      entries={data.entries}
      basePath={`/exams/${data.exam.examCode}/notebook`}
      preview={false}
    />
  );
}
