import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { SummaryCards } from "@/components/summary-cards.tsx";
import { findPublishedExam, listPublishedExams } from "@/lib/exam-data.ts";
import { loadSummaryCards } from "@/lib/summary-data.ts";

type Props = { params: Promise<{ code: string }> };

export const dynamicParams = false;

/** 要約カードのある資格だけ(ない資格は 404)。 */
export async function generateStaticParams() {
  const exams = await Promise.all(
    listPublishedExams().map(async (exam) => ({ exam, cards: await loadSummaryCards(exam) })),
  );
  return exams.filter(({ cards }) => cards !== null).map(({ exam }) => ({ code: exam.examCode }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { code } = await params;
  const exam = findPublishedExam(code);
  return { title: exam ? `${exam.shortName}の要約カード` : "要約カード" };
}

export default async function SummaryCardsPage({ params }: Props) {
  const { code } = await params;
  const exam = findPublishedExam(code);
  if (!exam) notFound();
  const cards = await loadSummaryCards(exam);
  if (!cards) notFound();

  return <SummaryCards exam={{ examCode: exam.examCode, name: exam.name, domains: exam.domains }} cards={cards} />;
}
