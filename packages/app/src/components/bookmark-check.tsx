"use client";

import Link from "next/link";
import { BookmarkError, BookmarkToggle, useBookmarks } from "@/components/bookmark-toggle.tsx";
import { InlineText, RichText } from "@/components/rich-text.tsx";
import type { PublishedExam, Question } from "@/lib/types.ts";

type Props = { exam: PublishedExam; questions: Question[] };

/** 資格ごとの、ブックマークした問題の一覧(正解と解説つき)。 */
export function BookmarkCheck({ exam, questions }: Props) {
  const bookmarks = useBookmarks(exam.examCode);
  // ブックマークを外しても、見ている間は一覧に残す(押し間違えたときに、すぐ付け直せるように)
  const shown = questions.filter((q) => bookmarks.ids?.has(q.questionId) || bookmarks.touched.has(q.questionId));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold">{exam.name}</h2>
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
        <ol className="space-y-4">
          {shown.map((question) => (
            <li key={question.questionId} className="space-y-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex justify-end">
                <BookmarkToggle questionId={question.questionId} bookmarks={bookmarks} />
              </div>
              <RichText text={question.questionText} />
              <ul className="space-y-1 text-sm">
                {question.choices.map((choice) => {
                  const isAnswer = question.correctAnswers.includes(choice.key);
                  return (
                    <li key={choice.key} className="rounded border border-line p-2">
                      <span className="font-bold">{choice.key}. </span>
                      <InlineText text={choice.text} />
                      {isAnswer ? <span className="ml-2 font-bold text-correct">(正解)</span> : null}
                    </li>
                  );
                })}
              </ul>
              <div className="space-y-2 border-t border-line pt-3">
                <h3 className="font-bold">解説</h3>
                <RichText text={question.explanation} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
