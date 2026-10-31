import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NotebookCover } from "@/components/notebook-view.tsx";
import { listPublishedExams } from "@/lib/exam-data.ts";
import { loadNotebook, loadNotebookPage } from "@/lib/notebook-data.ts";

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;

/** 体系ノートのある資格だけ(ない資格は 404)。 */
export async function generateStaticParams() {
  const exams = await Promise.all(
    listPublishedExams().map(async (exam) => ({ exam, notebook: await loadNotebook(exam) })),
  );
  return exams.filter(({ notebook }) => notebook !== null).map(({ exam }) => ({ code: exam.examCode }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const data = await loadNotebookPage(code, false);
  return { title: data ? `${data.exam.shortName}の体系ノート` : "体系ノート" };
}

/** 体系ノートの表紙(利用者の画面。検証済みの見出しだけを数える) */
export default async function NotebookPage({ params }: Props) {
  const { code } = await params;
  const data = await loadNotebookPage(code, false);
  if (!data) notFound();
  return (
    <NotebookCover exam={data.exam} toc={data.toc} basePath={`/exams/${data.exam.examCode}/notebook`} preview={false} />
  );
}
