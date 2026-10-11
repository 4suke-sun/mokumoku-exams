"use client";

import Link from "next/link";
import { useState } from "react";
import { BookmarkError, type Bookmarks, BookmarkToggle, useBookmarks } from "@/components/bookmark-toggle.tsx";
import { ReferenceList } from "@/components/reference-list.tsx";
import { InlineText, RichText } from "@/components/rich-text.tsx";
import type { PublishedExam, Question } from "@/lib/types.ts";

type Props = { exam: PublishedExam; questions: Question[] };

/** 表示の形式。一覧は正解と解説を並べ、カードは 1 問ずつめくって確かめる。 */
type View = "list" | "cards";

const VIEWS: { id: View; name: string }[] = [
  { id: "list", name: "一覧" },
  { id: "cards", name: "カード" },
];

/** 資格ごとの、ブックマークした問題の見直し(一覧とカードを切り替えられる)。 */
export function BookmarkCheck({ exam, questions }: Props) {
  const bookmarks = useBookmarks(exam.examCode);
  const [view, setView] = useState<View>("list");
  // ブックマークを外しても、見ている間は一覧に残す(押し間違えたときに、すぐ付け直せるように)
  const shown = questions.filter((q) => bookmarks.ids?.has(q.questionId) || bookmarks.touched.has(q.questionId));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="h2">{exam.name}</h2>
        <Link href={`/exams/${exam.examCode}`} className="text-sm text-primary hover:underline">
          ブックマークした問題だけを解く
        </Link>
      </div>
      <BookmarkError bookmarks={bookmarks} />
      {bookmarks.ids === null ? (
        <p className="text-sm text-muted">
          ブックマークを読み込んでいます。表示されないときは、時間をおいて開き直してください。
        </p>
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
                  <QuestionFace question={question} revealed />
                </li>
              ))}
            </ol>
          ) : (
            <FlashCards questions={shown} bookmarks={bookmarks} />
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
function QuestionFace({ question, revealed }: { question: Question; revealed: boolean }) {
  return (
    <>
      <RichText text={question.questionText} />
      {question.questionType === "free-text" ? (
        revealed ? (
          <div className="space-y-1 text-sm">
            <h3 className="font-bold">採点の観点(合格点 {question.rubric.passingPoints} 点)</h3>
            <ul className="space-y-1">
              {question.rubric.criteria.map((criterion) => (
                <li key={criterion.name} className="flex justify-between gap-3 rounded border border-line p-2">
                  <span>{criterion.name}</span>
                  <span>{criterion.points} 点</span>
                </li>
              ))}
            </ul>
          </div>
        ) : null
      ) : (
        <ul className="space-y-1 text-sm">
          {question.choices.map((choice) => {
            const isAnswer = revealed && question.correctAnswers.includes(choice.key);
            return (
              <li
                key={choice.key}
                className={`rounded border p-2 ${isAnswer ? "motion-correct border-correct bg-correct-bg" : "border-line"}`}
              >
                <span className="font-bold">{choice.key}. </span>
                <InlineText text={choice.text} />
                {isAnswer ? <span className="ml-2 font-bold text-correct">(正解)</span> : null}
              </li>
            );
          })}
        </ul>
      )}
      {revealed ? (
        <div className="space-y-2 border-t border-line pt-3">
          <h3 className="font-bold">解説</h3>
          <RichText text={question.explanation} />
          <ReferenceList references={question.references} />
        </div>
      ) : null}
    </>
  );
}

/** 1 問ずつのカード。表に問題、めくると正解と解説。前へ・次へで移ると、表に戻る。 */
function FlashCards({ questions, bookmarks }: { questions: Question[]; bookmarks: Bookmarks }) {
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
      <QuestionFace question={question} revealed={revealed} />
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
