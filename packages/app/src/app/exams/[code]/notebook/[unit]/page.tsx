import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotebookResume } from "@/components/notebook-progress.tsx";
import { NotebookSectionView } from "@/components/notebook-view.tsx";
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

/**
 * 中分類のページ(利用者の画面。検証済みの見出しだけを出す)。
 * 完了はアカウントから読むので、読み込みが終わるまでは最初の節を出し、終わったら、最初の、完了していない節へ移す
 * (すべて完了なら最初の節。見出しのない中分類は、移さず「まだ見出しがありません」を出す)。
 */
export default async function NotebookUnitPage({ params }: Props) {
  const { code, unit: unitId } = await params;
  const data = await loadNotebookPage(code, false);
  const unit = data?.units.find((u) => u.id === unitId);
  if (!data || !unit) notFound();
  const basePath = `/exams/${data.exam.examCode}/notebook`;
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
        preview={false}
      />
      {own.length > 0 ? <NotebookResume unit={{ id: unit.id, entries: own }} basePath={basePath} /> : null}
    </>
  );
}
