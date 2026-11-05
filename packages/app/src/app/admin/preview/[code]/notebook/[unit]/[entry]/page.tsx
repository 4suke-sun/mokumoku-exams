import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotebookSectionView } from "@/components/notebook-view.tsx";
import { loadNotebookPage } from "@/lib/notebook-data.ts";

type Props = { params: Promise<{ code: string; unit: string; entry: string }> };

export const metadata: Metadata = { title: "体系ノートのプレビュー" };

/** 節のページの管理者のプレビュー(未検証の見出しも出し、検証の状態を示す。完了を読まず、記録もしない) */
export default async function NotebookEntryPreviewPage({ params }: Props) {
  const { code, unit: unitId, entry: entryId } = await params;
  const data = await loadNotebookPage(code, true);
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
      basePath={`/admin/preview/${data.exam.examCode}/notebook`}
      preview
    />
  );
}
