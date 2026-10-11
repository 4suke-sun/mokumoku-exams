import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RichText } from "@/components/rich-text.tsx";
import { StudyStart } from "@/components/study-start.tsx";
import { loadCurriculum } from "@/lib/curriculum-data.ts";
import { findPublishedExam, listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";
import type { PublishedExam } from "@/lib/types.ts";

type Props = { params: Promise<{ code: string; unit: string }> };

export const dynamicParams = false;

export async function generateStaticParams() {
  const params = await Promise.all(
    listPublishedExams().map(async (exam) =>
      ((await loadCurriculum(exam)) ?? []).map((unit) => ({ code: exam.examCode, unit: unit.id })),
    ),
  );
  return params.flat();
}

async function findUnit(exam: PublishedExam, unitId: string) {
  return (await loadCurriculum(exam))?.find((unit) => unit.id === unitId);
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, unit: unitId } = await params;
  const exam = findPublishedExam(code);
  const unit = exam ? await findUnit(exam, unitId) : undefined;
  return { title: unit ? `${unit.title}(学習モード)` : "学習モード" };
}

export default async function StudyUnitPage({ params }: Props) {
  const { code, unit: unitId } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  const [unit, questions] = await Promise.all([findUnit(exam, unitId), loadQuestions(exam)]);
  if (!unit) notFound();

  // 出題に必要な情報だけを渡す。いまの問題データにない問題は除く(検査で落ちるため、通常は起きない)
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const items = unit.questionIds.flatMap((id) => {
    const question = byId.get(id);
    return question ? [{ questionId: id, choiceKeys: question.choices.map((c) => c.key) }] : [];
  });

  return (
    <article className="space-y-8">
      <div className="space-y-1">
        <Link href={`/exams/${exam.examCode}/study`} className="text-sm text-primary hover:underline">
          単元の一覧へ戻る
        </Link>
        <h1 className="text-2xl font-bold">{unit.title}</h1>
        <p className="text-sm text-muted">{exam.name}</p>
      </div>

      {unit.sections.map((section) => (
        <section
          key={section.id}
          id={section.id}
          aria-labelledby={`${section.id}-title`}
          className="space-y-3 rounded-lg border border-line bg-surface p-4"
        >
          <h2 id={`${section.id}-title`} className="text-xl font-bold">
            {section.title}
          </h2>
          <RichText text={section.body} />
        </section>
      ))}

      <StudyStart examCode={exam.examCode} items={items} />
    </article>
  );
}
