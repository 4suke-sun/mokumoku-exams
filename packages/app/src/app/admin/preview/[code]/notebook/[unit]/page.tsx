import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotebookResume } from "@/components/notebook-progress.tsx";
import { NotebookSectionView } from "@/components/notebook-view.tsx";
import { loadNotebookPage } from "@/lib/notebook-data.ts";

type Props = { params: Promise<{ code: string; unit: string }> };

export const metadata: Metadata = { title: "体系ノートのプレビュー" };

/**
 * 中分類のページの管理者のプレビュー(未検証の見出しも出し、検証の状態を示す)。
 * 完了を読まないので、最初の節の URL へ移す(見出しのない中分類は、移さない)。
 */
export default async function NotebookUnitPreviewPage({ params }: Props) {
  const { code, unit: unitId } = await params;
  const data = await loadNotebookPage(code, true);
  const unit = data?.units.find((u) => u.id === unitId);
  if (!data || !unit) notFound();
  const basePath = `/admin/preview/${data.exam.examCode}/notebook`;
  const own = data.entries.filter((e) => e.unit === unit.id);
  return (
    <>
      <NotebookSectionView
        exam={data.exam}
        units={data.units}
        unit={unit}
        entry={own[0] ?? null}
        entries={data.entries}
        basePath={basePath}
        preview
      />
      {own.length > 0 ? <NotebookResume unit={{ id: unit.id, entries: own }} basePath={basePath} /> : null}
    </>
  );
}
