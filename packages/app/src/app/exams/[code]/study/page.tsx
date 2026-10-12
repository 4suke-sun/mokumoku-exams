import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { loadCurriculumFile } from "@/lib/curriculum-data.ts";
import { domainColorClasses } from "@/lib/domain-color.ts";
import { findPublishedExam, listPublishedExams } from "@/lib/exam-data.ts";
import { entryHref, groupByDomain } from "@/lib/study-nav.ts";

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;

/** カリキュラムのある資格だけ(ない資格は 404)。 */
export async function generateStaticParams() {
  const exams = await Promise.all(
    listPublishedExams().map(async (exam) => ({ exam, curriculum: await loadCurriculumFile(exam) })),
  );
  return exams.filter(({ curriculum }) => curriculum !== null).map(({ exam }) => ({ code: exam.examCode }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const exam = findPublishedExam(code);
  return { title: exam ? `${exam.shortName}の学習モード` : "学習モード" };
}

/** 学習モードの入口: 分野の一覧(説明、単元の数、問題の数)。 */
export default async function StudyPage({ params }: Props) {
  const { code } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  const curriculum = await loadCurriculumFile(exam);
  if (!curriculum) notFound();
  const groups = groupByDomain(exam.domains, curriculum.domains, curriculum.units);

  return (
    <section className="space-y-8">
      <div className="space-y-1">
        <Link href={`/exams/${exam.examCode}`} className="text-sm text-primary hover:underline">
          モード選択へ戻る
        </Link>
        <h1 className="h1">学習モード</h1>
        <p className="text-sm text-muted">{exam.name}。分野を選び、単元を読んでから、その単元の問題を解きます。</p>
      </div>

      <ol className="motion-stagger grid gap-3 sm:grid-cols-2">
        {groups.map((group, i) => {
          const color = domainColorClasses(exam.domains, group.code);
          return (
            <li key={group.code}>
              <Link
                href={entryHref(exam.examCode, group)}
                className={`card h-full space-y-2 border-l-4 p-4 ${color?.border ?? ""}`}
              >
                <span className={`block font-bold ${color?.text ?? "text-primary"}`}>
                  {i + 1}. {group.name}
                </span>
                {group.summary ? <span className="block text-sm text-muted">{group.summary}</span> : null}
                <span className="block text-sm">
                  単元 {group.units.length} 件 / 問題 {group.questionCount} 問
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
