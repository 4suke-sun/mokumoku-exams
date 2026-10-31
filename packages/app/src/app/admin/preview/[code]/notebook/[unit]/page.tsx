import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotebookUnitView } from "@/components/notebook-view.tsx";
import { loadNotebookPage } from "@/lib/notebook-data.ts";

type Props = { params: Promise<{ code: string; unit: string }> };

export const metadata: Metadata = { title: "体系ノートのプレビュー" };

/** 中分類のページの管理者のプレビュー(未検証の見出しも出し、検証の状態を示す) */
export default async function NotebookUnitPreviewPage({ params }: Props) {
  const { code, unit: unitId } = await params;
  const data = await loadNotebookPage(code, true);
  const unit = data?.units.find((u) => u.id === unitId);
  if (!data || !unit) notFound();
  return (
    <NotebookUnitView
      exam={data.exam}
      units={data.units}
      unit={unit}
      entries={data.entries}
      basePath={`/admin/preview/${data.exam.examCode}/notebook`}
      preview
    />
  );
}
