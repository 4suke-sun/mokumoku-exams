import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CodeDrillPlayer } from "@/components/code-drill-player.tsx";
import { loadCodeDrillPage } from "@/lib/code-drill-data.ts";
import { listPublishedExams } from "@/lib/exam-data.ts";

type Props = { params: Promise<{ code: string; id: string }> };

export const dynamicParams = false;

export async function generateStaticParams() {
  const params = await Promise.all(
    listPublishedExams().map(async (exam) =>
      ((await loadCodeDrillPage(exam.examCode, false))?.problems ?? []).map((p) => ({ code: exam.examCode, id: p.id })),
    ),
  );
  return params.flat();
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, id } = await params;
  const problem = (await loadCodeDrillPage(code, false))?.problems.find((p) => p.id === id);
  return { title: problem ? `${problem.title}(コードドリル)` : "コードドリル" };
}

/** コードドリルの 1 問(利用者の画面。検証済みの問題だけ) */
export default async function CodeDrillProblemPage({ params }: Props) {
  const { code, id } = await params;
  const data = await loadCodeDrillPage(code, false);
  const index = data?.problems.findIndex((p) => p.id === id) ?? -1;
  const problem = data?.problems[index];
  if (!data || !problem) notFound();
  const basePath = `/exams/${data.exam.examCode}/code-drill`;
  const next = data.problems[index + 1];
  return (
    <>
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
