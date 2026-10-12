import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { InlineText } from "@/components/rich-text.tsx";
import { loadCurriculumFile } from "@/lib/curriculum-data.ts";
import { domainColorClasses } from "@/lib/domain-color.ts";
import { findPublishedExam, listPublishedExams } from "@/lib/exam-data.ts";
import { groupByDomain, studyHref, unitHref } from "@/lib/study-nav.ts";

type Props = { params: Promise<{ code: string; domain: string }> };

export const dynamicParams = false;

export async function generateStaticParams() {
  const params = await Promise.all(
    listPublishedExams().map(async (exam) => {
      const curriculum = await loadCurriculumFile(exam);
      if (!curriculum) return [];
      return groupByDomain(exam.domains, curriculum.domains, curriculum.units).map((group) => ({
        code: exam.examCode,
        domain: group.code,
      }));
    }),
  );
  return params.flat();
}

async function findGroup(code: string, domain: string) {
  const exam = findPublishedExam(code);
  const curriculum = exam ? await loadCurriculumFile(exam) : null;
  if (!exam || !curriculum) return null;
  const group = groupByDomain(exam.domains, curriculum.domains, curriculum.units).find((g) => g.code === domain);
  return group ? { exam, group } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, domain } = await params;
  const found = await findGroup(code, domain);
  return { title: found ? `${found.group.name}(学習モード)` : "学習モード" };
}

/** 分野の単元の一覧(要約つき)。 */
export default async function StudyDomainPage({ params }: Props) {
  const { code, domain } = await params;
  const found = await findGroup(code, domain);
  if (!found) notFound();
  const { exam, group } = found;
  const color = domainColorClasses(exam.domains, group.code);

  return (
    <section className="space-y-8">
      <div className="space-y-1">
        <Link href={studyHref(exam.examCode)} className="text-sm text-primary hover:underline">
          分野の一覧へ戻る
        </Link>
        <h1 className={`h1 ${color?.text ?? ""}`}>{group.name}</h1>
        {group.summary ? <p className="text-sm text-muted">{group.summary}</p> : null}
      </div>

      <ol className="motion-stagger space-y-3">
        {group.units.map((unit, i) => (
          <li key={unit.id}>
            <Link
              href={unitHref(exam.examCode, unit.id)}
              className={`card space-y-2 border-l-4 p-4 ${color?.border ?? ""}`}
            >
              <span className="block font-bold text-primary">
                {i + 1}. {unit.title}
              </span>
              {unit.summary && unit.summary.length > 0 ? (
                <ul className="list-disc space-y-1 pl-5 text-sm text-muted">
                  {unit.summary.map((point, j) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: 内容は固定で、並べ替えない
                    <li key={j}>
                      <InlineText text={point} mark />
                    </li>
                  ))}
                </ul>
              ) : null}
              <span className="block text-sm">
                {unit.sections.length} 節 / 問題 {unit.questionIds.length} 問
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}
