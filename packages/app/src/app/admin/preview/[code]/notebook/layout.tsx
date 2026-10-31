import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { NotebookShell } from "@/components/notebook-shell.tsx";
import { loadNotebookPage } from "@/lib/notebook-data.ts";

type Props = { children: ReactNode; params: Promise<{ code: string }> };

/**
 * 体系ノートの管理者のプレビューの枠。未検証の見出しも数える。
 * 管理者だけが開ける(`/admin` 以下は、入口とレイアウトの両方で管理者を確かめる)。
 */
export default async function NotebookPreviewLayout({ children, params }: Props) {
  const { code } = await params;
  const data = await loadNotebookPage(code, true);
  if (!data) notFound();
  return (
    <NotebookShell basePath={`/admin/preview/${data.exam.examCode}/notebook`} toc={data.toc}>
      {children}
    </NotebookShell>
  );
}
