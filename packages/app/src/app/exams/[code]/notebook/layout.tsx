import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { NotebookShell } from "@/components/notebook-shell.tsx";
import { loadNotebookPage } from "@/lib/notebook-data.ts";

type Props = { children: ReactNode; params: Promise<{ code: string }> };

/** 体系ノートの枠(2 段の目次)。利用者の画面なので、目次の数は検証済みの見出しだけで数える */
export default async function NotebookLayout({ children, params }: Props) {
  const { code } = await params;
  const data = await loadNotebookPage(code, false);
  if (!data) notFound();
  return (
    <NotebookShell
      examCode={data.exam.examCode}
      preview={false}
      basePath={`/exams/${data.exam.examCode}/notebook`}
      toc={data.toc}
    >
      {children}
    </NotebookShell>
  );
}
