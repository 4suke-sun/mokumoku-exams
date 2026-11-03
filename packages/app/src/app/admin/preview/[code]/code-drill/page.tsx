import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CodeDrillList } from "@/components/code-drill-list.tsx";
import { loadCodeDrillPage } from "@/lib/code-drill-data.ts";

type Props = { params: Promise<{ code: string }> };

export const metadata: Metadata = { title: "コードドリルのプレビュー" };

/** コードドリルの一覧の管理者のプレビュー(未検証の問題も出す) */
export default async function CodeDrillPage({ params }: Props) {
  const { code } = await params;
  const data = await loadCodeDrillPage(code, true);
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
      basePath={`/admin/preview/${data.exam.examCode}/code-drill`}
      preview={true}
    />
  );
}
