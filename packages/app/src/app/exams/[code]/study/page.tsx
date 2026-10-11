import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCurriculum } from "@/lib/curriculum-data.ts";
import { findPublishedExam, listPublishedExams } from "@/lib/exam-data.ts";

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;

/** カリキュラムのある資格だけ(ない資格は 404)。 */
export async function generateStaticParams() {
  const exams = await Promise.all(
    listPublishedExams().map(async (exam) => ({ exam, units: await loadCurriculum(exam) })),
  );
  return exams.filter(({ units }) => units !== null).map(({ exam }) => ({ code: exam.examCode }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const exam = findPublishedExam(code);
  return { title: exam ? `${exam.shortName}の学習モード` : "学習モード" };
}

export default async function StudyPage({ params }: Props) {
  const { code } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  const units = await loadCurriculum(exam);
  if (!units) notFound();

  return (
    <section className="space-y-8">
      <div className="space-y-1">
        <Link href={`/exams/${exam.examCode}`} className="text-sm text-primary hover:underline">
          モード選択へ戻る
        </Link>
        <h1 className="h1">学習モード</h1>
        <p className="text-sm text-muted">{exam.name}。単元を読んでから、その単元の問題を解きます。</p>
      </div>

      <ol className="space-y-2">
        {units.map((unit, i) => (
          <li key={unit.id}>
            <Link href={`/exams/${exam.examCode}/study/${unit.id}`} className="card p-4">
              <span className="block font-bold text-primary">
                {i + 1}. {unit.title}
              </span>
              <span className="block text-sm text-muted">
                {unit.sections.length} 節 / 問題 {unit.questionIds.length} 問
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
