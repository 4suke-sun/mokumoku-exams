"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookmarkError, type Bookmarks, BookmarkToggle, useBookmarks } from "@/components/bookmark-toggle.tsx";
import { ChoiceChip, ChoiceReview } from "@/components/choice-review.tsx";
import { ExplanationView } from "@/components/explanation-view.tsx";
import { QuestionChips } from "@/components/question-chips.tsx";
import { ReferenceList } from "@/components/reference-list.tsx";
import { ReportLink } from "@/components/report-link.tsx";
import { InlineText, RichText } from "@/components/rich-text.tsx";
import { RubricView } from "@/components/rubric-view.tsx";
import { fetchQuestions } from "@/lib/questions/client.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";

/** `order` は、資格の全問の ID(問題データの並び)。問題そのものは、ブックマークした分だけを、開いたあとに取る */
type Props = { exam: PublishedExam; order: readonly string[] };

/** 表示の形式。一覧は正解と解説を並べ、カードは 1 問ずつめくって確かめる。 */
type View = "list" | "cards";

const VIEWS: { id: View; name: string }[] = [
  { id: "list", name: "一覧" },
  { id: "cards", name: "カード" },
];

/** 資格ごとの、ブックマークした問題の見直し(一覧とカードを切り替えられる)。 */
export function BookmarkCheck({ exam, order }: Props) {
  const bookmarks = useBookmarks(exam.examCode);
  const [view, setView] = useState<View>("list");
  // ブックマークした問題(読み込んだときの分)。null は読み込み中、"failed" は取れなかったとき
  const [loaded, setLoaded] = useState<ReadonlyMap<string, Question> | "failed" | null>(null);
  const ready = bookmarks.ids !== null;

  // ブックマークを読み込めたら、その問題だけを取る(画面で付け直す問題は、読み込んだ分の中にある)
  // biome-ignore lint/correctness/useExhaustiveDependencies: 読み込めたときに 1 回だけ取る(付け外しのたびには取り直さない)
  useEffect(() => {
    if (!bookmarks.ids) return;
    let active = true;
    const ids = order.filter((id) => bookmarks.ids?.has(id));
    void fetchQuestions(exam.examCode, ids).then((questions) => {
      if (active) setLoaded(questions ? new Map(questions.map((q) => [q.questionId, q])) : "failed");
    });
    return () => {
      active = false;
    };
  }, [exam.examCode, order, ready]);

  // ブックマークを外しても、見ている間は一覧に残す(押し間違えたときに、すぐ付け直せるように)
  const shown =
    loaded instanceof Map
      ? order.flatMap((id) => (bookmarks.ids?.has(id) || bookmarks.touched.has(id) ? (loaded.get(id) ?? []) : []))
      : [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="h2">{exam.name}</h2>
        <Link href={`/exams/${exam.examCode}`} className="text-sm text-primary hover:underline">
          ブックマークした問題だけを解く
        </Link>
      </div>
      <BookmarkError bookmarks={bookmarks} />
      {bookmarks.ids === null || loaded === null ? (
        <p className="text-sm text-muted">
          ブックマークを読み込んでいます。表示されないときは、時間をおいて開き直してください。
        </p>
      ) : loaded === "failed" ? (
        <p className="text-sm text-muted">問題を読み込めませんでした。時間をおいて、開き直してください。</p>
      ) : shown.length === 0 ? (
        <p className="text-sm text-muted">
          ブックマークした問題はありません。出題中や結果の画面の「ブックマーク」で追加できます。
        </p>
      ) : (
        <>
          <fieldset className="flex gap-2">
            <legend className="sr-only">表示の形式</legend>
            {VIEWS.map((item) => (
              <button
                key={item.id}
                type="button"
                aria-pressed={view === item.id}
                onClick={() => setView(item.id)}
                className={`rounded-md border px-3 py-1 text-sm font-bold ${
                  view === item.id ? "border-primary text-primary" : "border-line"
                }`}
              >
                {item.name}
              </button>
            ))}
          </fieldset>
          {view === "list" ? (
            <ol className="space-y-4">
              {shown.map((question) => (
                <li key={question.questionId} className="card space-y-3 p-4">
                  <div className="flex justify-end">
                    <BookmarkToggle questionId={question.questionId} bookmarks={bookmarks} />
                  </div>
                  <QuestionFace question={question} revealed domains={exam.domains} examCode={exam.examCode} />
                </li>
              ))}
            </ol>
          ) : (
            <FlashCards questions={shown} bookmarks={bookmarks} domains={exam.domains} examCode={exam.examCode} />
          )}
        </>
      )}
    </div>
  );
}

/**
 * 問題文と選択肢。`revealed` のときは、正解の印と解説も出す。
 * 自由記述は選択肢がないので、`revealed` のときに採点の観点を出す。
 */
function QuestionFace({
  question,
  revealed,
  domains,
  examCode,
}: {
  question: Question;
  revealed: boolean;
  domains: PublishedExam["domains"];
  examCode: string;
}) {
  return (
    <>
      <QuestionChips domains={domains} question={question} />
      <RichText text={question.questionText} />
      {question.questionType === "free-text" ? (
        revealed ? (
          <RubricView rubric={question.rubric} mode="criteria" />
        ) : null
      ) : revealed ? (
        <div className="motion-correct">
          <ChoiceReview question={question} />
        </div>
      ) : (
        <ul className="space-y-2 text-sm">
          {question.choices.map((choice) => (
            <li key={choice.key} className="flex items-start gap-3 rounded-md border border-line p-3">
              <ChoiceChip label={choice.key} />
              <span className="pt-0.5">
                <InlineText text={choice.text} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {revealed ? (
        <div className="space-y-2 border-t border-line pt-3">
          <h3 className="font-bold">解説</h3>
          <ExplanationView question={question} headingLevel={4} />
          <ReferenceList references={question.references} />
        </div>
      ) : null}
      <ReportLink examCode={examCode} questionId={question.questionId} />
    </>
  );
}

/** 1 問ずつのカード。表に問題、めくると正解と解説。前へ・次へで移ると、表に戻る。 */
function FlashCards({
  questions,
  bookmarks,
  domains,
  examCode,
}: {
  questions: Question[];
  bookmarks: Bookmarks;
  domains: PublishedExam["domains"];
  examCode: string;
}) {
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  // 見ている間に一覧から減ることはないが、念のため範囲に収める
  const current = Math.min(index, questions.length - 1);
  const question = questions[current];
  if (!question) return null;

  function move(next: number) {
    setIndex(next);
    setRevealed(false);
  }

  return (
    <div className="card space-y-3 p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted">
          {current + 1} / {questions.length} 問目
        </p>
        <BookmarkToggle questionId={question.questionId} bookmarks={bookmarks} />
      </div>
      <QuestionFace question={question} revealed={revealed} domains={domains} examCode={examCode} />
      <button
        type="button"
        onClick={() => setRevealed((r) => !r)}
        className="w-full rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
      >
        {revealed ? "問題に戻す" : "めくって正解を見る"}
      </button>
      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => move(current - 1)}
          disabled={current === 0}
          className="flex-1 rounded-md border border-line px-5 py-3 font-bold disabled:opacity-50"
        >
          前へ
        </button>
        <button
          type="button"
          onClick={() => move(current + 1)}
          disabled={current === questions.length - 1}
          className="flex-1 rounded-md border border-line px-5 py-3 font-bold disabled:opacity-50"
        >
          次へ
        </button>
      </div>
    </div>
  );
}
