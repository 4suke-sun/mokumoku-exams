"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { answerFor, isCorrect, passLinePercent, score } from "@/lib/quiz.ts";
import { browserStore, loadResults, type Result } from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";

type Props = { exam: PublishedExam; questions: Question[] };

type State = { status: "loading" } | { status: "ready"; results: Result[] };

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

function keysLabel(keys: readonly string[]): string {
  return keys.length === 0 ? "未回答" : keys.join("、");
}

export function ResultView({ exam, questions }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    setState({ status: "ready", results: loadResults(browserStore(), exam.examCode) });
  }, [exam.examCode]);

  if (state.status === "loading") {
    return <p className="text-muted">読み込んでいます…</p>;
  }

  const [latest, ...previous] = state.results;
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const answered = latest
    ? latest.questionIds.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined)
    : [];

  if (!latest || answered.length === 0) {
    return (
      <section className="space-y-4">
        <h1 className="text-2xl font-bold">結果がありません</h1>
        <p className="text-muted">問題を解くと、ここに結果が表示されます。</p>
        <Link
          href={`/exams/${exam.examCode}`}
          className="inline-block rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
        >
          モード選択へ
        </Link>
      </section>
    );
  }

  const result = score(answered, latest.answers);
  const passLine = passLinePercent(exam);
  const reached = result.percent >= passLine;

  return (
    <section className="space-y-8">
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">結果</h1>
        <p className="text-sm text-muted">
          {exam.name} / {formatDate(latest.finishedAt)}
        </p>
        <div className="rounded-lg border border-line bg-surface p-5">
          <p className="text-4xl font-bold">{result.percent}%</p>
          <p className="mt-1">
            {result.total} 問中 {result.correct} 問が正解です。
          </p>
          <p className={`mt-2 font-bold ${reached ? "text-correct" : "text-warn"}`}>
            {reached
              ? `合格ライン(${passLine}%)に達しています。この調子です。`
              : `合格ライン(${passLine}%)まであと少しです。間違えた問題を見直しましょう。`}
          </p>
        </div>
      </div>

      <div className="space-y-4">
        <h2 className="text-lg font-bold">問題ごとの結果</h2>
        <ol className="space-y-4">
          {answered.map((question, i) => {
            const selected = answerFor(latest.answers, question.questionId);
            const correct = isCorrect(question, selected);
            return (
              <li key={question.questionId} className="space-y-3 rounded-lg border border-line bg-surface p-4">
                <p className={`font-bold ${correct ? "text-correct" : "text-incorrect"}`}>
                  {correct ? "○ 正解" : "× 不正解"}
                  <span className="ml-2 text-fg">問題 {i + 1}</span>
                </p>
                <p className="whitespace-pre-wrap leading-relaxed">{question.questionText}</p>
                <ul className="space-y-1 text-sm">
                  {question.choices.map((choice) => {
                    const isAnswer = question.correctAnswers.includes(choice.key);
                    const chosen = selected.includes(choice.key);
                    return (
                      <li key={choice.key} className="rounded border border-line p-2">
                        <span className="font-bold">{choice.key}. </span>
                        <span className="whitespace-pre-wrap">{choice.text}</span>
                        {isAnswer ? <span className="ml-2 font-bold text-correct">(正解)</span> : null}
                        {chosen ? <span className="ml-2 text-muted">(あなたの回答)</span> : null}
                        {choice.explanation ? <p className="mt-1 text-muted">{choice.explanation}</p> : null}
                      </li>
                    );
                  })}
                </ul>
                <p className="text-sm text-muted">
                  あなたの回答: {keysLabel(selected)} / 正解: {keysLabel(question.correctAnswers)}
                </p>
                <p className="whitespace-pre-wrap leading-relaxed">{question.explanation}</p>
                {question.supplement ? (
                  <p className="whitespace-pre-wrap text-sm text-muted">{question.supplement}</p>
                ) : null}
              </li>
            );
          })}
        </ol>
      </div>

      {previous.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-lg font-bold">これまでの結果</h2>
          <ul className="space-y-1 text-sm">
            {previous.map((past) => {
              const pastScore = score(
                past.questionIds.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined),
                past.answers,
              );
              return (
                <li key={past.finishedAt} className="flex justify-between rounded border border-line bg-surface p-2">
                  <span>{formatDate(past.finishedAt)}</span>
                  <span>
                    {pastScore.correct} / {pastScore.total} 問({pastScore.percent}%)
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex gap-3">
        <Link
          href={`/exams/${exam.examCode}`}
          className="flex-1 rounded-md bg-primary px-5 py-3 text-center font-bold text-on-primary hover:opacity-90"
        >
          もう一度解く
        </Link>
        <Link href="/exams" className="rounded-md border border-line bg-surface px-5 py-3 font-bold">
          資格の一覧へ
        </Link>
      </div>
    </section>
  );
}
