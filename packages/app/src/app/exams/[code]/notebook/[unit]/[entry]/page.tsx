import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotebookSectionView } from "@/components/notebook-view.tsx";
import { listPublishedExams } from "@/lib/exam-data.ts";
import { loadNotebook, loadNotebookPage, visibleEntries } from "@/lib/notebook-data.ts";

type Props = { params: Promise<{ code: string; unit: string; entry: string }> };

export const dynamicParams = false;

/** 節(検証済みの見出し)ごとに 1 ページ。未検証の見出しは、利用者の画面の経路を作らない */
export async function generateStaticParams() {
  const params = await Promise.all(
    listPublishedExams().map(async (exam) => {
      const notebook = await loadNotebook(exam);
      return visibleEntries(notebook?.entries ?? [], false).map((entry) => ({
        code: exam.examCode,
        unit: entry.unit,
        entry: entry.id,
      }));
    }),
  );
  return params.flat();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, unit: unitId, entry: entryId } = await params;
  const entry = (await loadNotebookPage(code, false))?.entries.find((e) => e.unit === unitId && e.id === entryId);
  return { title: entry ? `${entry.term}(体系ノート)` : "体系ノート" };
}

/** 節のページ(利用者の画面。検証済みの見出しだけを出す) */
export default async function NotebookEntryPage({ params }: Props) {
  const { code, unit: unitId, entry: entryId } = await params;
  const data = await loadNotebookPage(code, false);
  const unit = data?.units.find((u) => u.id === unitId);
  const entry = data?.entries.find((e) => e.unit === unitId && e.id === entryId);
  if (!data || !unit || !entry) notFound();
  return (
    <NotebookSectionView
      exam={data.exam}
      units={data.units}
      unit={unit}
      entry={entry}
      entries={data.entries}
      basePath={`/exams/${data.exam.examCode}/notebook`}
      preview={false}
    />
  );
}
