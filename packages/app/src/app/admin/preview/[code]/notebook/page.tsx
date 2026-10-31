import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotebookCover } from "@/components/notebook-view.tsx";
import { loadNotebookPage } from "@/lib/notebook-data.ts";

type Props = { params: Promise<{ code: string }> };

export const metadata: Metadata = { title: "体系ノートのプレビュー" };

/** 体系ノートの表紙の管理者のプレビュー(未検証の見出しも数える) */
export default async function NotebookPreviewPage({ params }: Props) {
  const { code } = await params;
  const data = await loadNotebookPage(code, true);
  if (!data) notFound();
  return (
    <NotebookCover exam={data.exam} toc={data.toc} basePath={`/admin/preview/${data.exam.examCode}/notebook`} preview />
  );
}
