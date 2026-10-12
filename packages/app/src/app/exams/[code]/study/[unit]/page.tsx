import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DiagramView } from "@/components/diagram.tsx";
import { ReferenceList } from "@/components/reference-list.tsx";
import { BlockList } from "@/components/rich-text.tsx";
import { StudyCard } from "@/components/study-card.tsx";
import { StudyStart } from "@/components/study-start.tsx";
import { UnitSummary } from "@/components/unit-summary.tsx";
import { loadCurriculumFile } from "@/lib/curriculum-data.ts";
import { domainColorClasses } from "@/lib/domain-color.ts";
import { findPublishedExam, listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";
import { splitBody } from "@/lib/study-body.ts";
import { backHref, groupByDomain, nextStep } from "@/lib/study-nav.ts";
import type { ChoiceQuestion, PublishedExam, Reference } from "@/lib/types.ts";

type Props = { params: Promise<{ code: string; unit: string }> };

export const dynamicParams = false;

export async function generateStaticParams() {
  const params = await Promise.all(
    listPublishedExams().map(async (exam) =>
      ((await loadCurriculumFile(exam))?.units ?? []).map((unit) => ({ code: exam.examCode, unit: unit.id })),
    ),
  );
  return params.flat();
}

async function findUnit(exam: PublishedExam, unitId: string) {
  const curriculum = await loadCurriculumFile(exam);
  const unit = curriculum?.units.find((u) => u.id === unitId);
  return curriculum && unit ? { curriculum, unit } : null;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code, unit: unitId } = await params;
  const exam = findPublishedExam(code);
  const found = exam ? await findUnit(exam, unitId) : null;
  return { title: found ? `${found.unit.title}(学習モード)` : "学習モード" };
}

/** 節の出典をまとめる(同じ URL は 1 回だけ) */
function mergeReferences(lists: (readonly Reference[] | undefined)[]): Reference[] {
  const seen = new Set<string>();
  return lists.flatMap((list) =>
    (list ?? []).filter((reference) => {
      if (seen.has(reference.url)) return false;
      seen.add(reference.url);
      return true;
    }),
  );
}

export default async function StudyUnitPage({ params }: Props) {
  const { code, unit: unitId } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  const [found, questions] = await Promise.all([findUnit(exam, unitId), loadQuestions(exam)]);
  if (!found) notFound();
  const { curriculum, unit } = found;

  const groups = groupByDomain(exam.domains, curriculum.domains, curriculum.units);
  const group = groups.find((g) => g.units.some((u) => u.id === unit.id));
  const color = domainColorClasses(exam.domains, unit.domain);

  // その場で解く問題は、択一・複数選択だけ。自由記述は、出題の画面(モード選択の「自由記述」)で解く
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const choiceQuestions = unit.questionIds.flatMap((id) => {
    const question = byId.get(id);
    return question && question.questionType !== "free-text" ? [question as ChoiceQuestion] : [];
  });
  // 段階の確認問題は、出題の画面で解く(結果で段階の合否を決める)。出題に必要な情報だけを渡す
  const toItems = (ids: readonly string[]) =>
    ids.flatMap((id) => {
      const question = byId.get(id);
      if (!question) return [];
      return [
        { questionId: id, choiceKeys: question.questionType === "free-text" ? [] : question.choices.map((c) => c.key) },
      ];
    });
  const stages = unit.stages
    ? { unitId: unit.id, list: unit.stages.map((stage) => ({ order: stage.order, items: toItems(stage.questionIds) })) }
    : undefined;

  const parts = unit.sections.map((section, i) => ({ section, ...splitBody(section.body, i === 0) }));
  const goal = parts[0]?.goal ?? [];
  const points = parts.flatMap((part) => part.point);
  const references = mergeReferences(unit.sections.map((s) => s.references));

  return (
    <article className="space-y-6">
      <div className="space-y-1">
        <Link
          href={group ? backHref(exam.examCode, group) : `/exams/${exam.examCode}/study`}
          className="text-sm text-primary hover:underline"
        >
          {group && group.units.length > 1 ? `${group.name}の単元の一覧へ戻る` : "分野の一覧へ戻る"}
        </Link>
        <h1 className="h1">{unit.title}</h1>
        <p className="text-sm text-muted">
          {exam.name}
          {group ? <span className={`ml-2 font-bold ${color?.text ?? ""}`}>{group.name}</span> : null}
        </p>
      </div>

      {goal.length > 0 ? (
        <StudyCard id="study_goal" tone="primary" icon="🎯" title="この単元で学ぶこと">
          <BlockList blocks={goal} className="text-lg" />
        </StudyCard>
      ) : null}

      {parts.map(({ section, main }) =>
        main.length > 0 || section.diagram ? (
          <div key={section.id} id={section.id} className="space-y-6">
            {main.length > 0 ? (
              <StudyCard id={`${section.id}`} tone="muted" icon="📖" title={section.title}>
                <BlockList blocks={main} />
              </StudyCard>
            ) : null}
            {section.diagram ? (
              <StudyCard
                id={`study_diagram_${section.id}`}
                tone="violet"
                icon="🗺️"
                title={`図で確かめる: ${section.title}`}
                titleClassName="text-lg font-bold"
              >
                <DiagramView diagram={section.diagram} id={`${section.id}-diagram`} />
              </StudyCard>
            ) : null}
          </div>
        ) : null,
      )}

      <UnitSummary summary={unit.summary} />

      {points.length > 0 ? (
        <StudyCard id="study_point" tone="orange" icon="💡" title="ここがポイント">
          <BlockList blocks={points} boldLabels />
        </StudyCard>
      ) : null}

      {references.length > 0 ? (
        <StudyCard id="study_references" tone="muted" icon="🔗" title="出典" titleClassName="text-lg font-bold">
          <ReferenceList references={references} heading={false} />
        </StudyCard>
      ) : null}

      <StudyStart
        exam={{ examCode: exam.examCode, domains: exam.domains }}
        questions={choiceQuestions}
        next={nextStep(exam.examCode, groups, unit.id)}
        stages={stages}
      />
    </article>
  );
}
