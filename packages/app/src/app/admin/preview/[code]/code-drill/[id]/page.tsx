import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CodeDrillPlayer } from "@/components/code-drill-player.tsx";
import { loadCodeDrillPage } from "@/lib/code-drill-data.ts";

type Props = { params: Promise<{ code: string; id: string }> };

export const metadata: Metadata = { title: "コードドリルのプレビュー" };

/** コードドリルの 1 問の管理者のプレビュー(未検証の問題も出す) */
export default async function CodeDrillProblemPage({ params }: Props) {
  const { code, id } = await params;
  const data = await loadCodeDrillPage(code, true);
  const index = data?.problems.findIndex((p) => p.id === id) ?? -1;
  const problem = data?.problems[index];
  if (!data || !problem) notFound();
  const basePath = `/admin/preview/${data.exam.examCode}/code-drill`;
  const next = data.problems[index + 1];
  return (
    <>
      <p className="mb-4 rounded-md border border-warn bg-warn-bg px-3 py-2 text-sm">
        管理者のプレビューです。
        {problem.status === "verified" ? "検証済みの問題です。" : "未検証の問題です(利用者の画面には出しません)。"}
      </p>
      <CodeDrillPlayer
        key={problem.id}
        problem={problem}
        domainName={data.exam.domains.find((d) => d.code === problem.domain)?.name ?? ""}
        basePath={basePath}
        nextHref={next ? `${basePath}/${next.id}` : null}
      />
    </>
  );
}
