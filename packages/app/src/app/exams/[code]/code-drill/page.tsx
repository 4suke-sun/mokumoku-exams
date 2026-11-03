import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CodeDrillList } from "@/components/code-drill-list.tsx";
import { loadCodeDrillPage } from "@/lib/code-drill-data.ts";
import { listPublishedExams } from "@/lib/exam-data.ts";

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;

/** コードドリルのある資格だけ(ない資格は 404) */
export async function generateStaticParams() {
  const exams = await Promise.all(
    listPublishedExams().map(async (exam) => ({ exam, data: await loadCodeDrillPage(exam.examCode, false) })),
  );
  return exams.filter(({ data }) => data !== null).map(({ exam }) => ({ code: exam.examCode }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const data = await loadCodeDrillPage(code, false);
  return { title: data ? `${data.exam.shortName}のコードドリル` : "コードドリル" };
}

/** コードドリルの一覧(利用者の画面。検証済みの問題だけを出す) */
export default async function CodeDrillPage({ params }: Props) {
  const { code } = await params;
  const data = await loadCodeDrillPage(code, false);
  if (!data) notFound();
  return (
    <CodeDrillList
      examCode={data.exam.examCode}
      examName={data.exam.name}
      domains={data.exam.domains}
      problems={data.problems.map(({ id, domain, language, title, status }) => ({
        id,
        domain,
        language,
        title,
        status,
      }))}
      basePath={`/exams/${data.exam.examCode}/code-drill`}
      preview={false}
    />
  );
}
