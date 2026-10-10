"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state.tsx";
import { InlineText, RichText } from "@/components/rich-text.tsx";
import { answerFor, orderChoices, sortKeys } from "@/lib/quiz.ts";
import { browserStore, clearSession, loadSession, type Session, saveResult, saveSession } from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";

type Props = { exam: PublishedExam; questions: Question[] };

type State = { status: "loading" } | { status: "empty" } | { status: "ready"; session: Session };

export function Player({ exam, questions }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const session = loadSession(browserStore(), exam.examCode);
    const ids = new Set(questions.map((q) => q.questionId));
    // 出題中の問題が、いまのデータにすべてあるときだけ続きから解く
    const usable = session?.questionIds.every((id) => ids.has(id)) === true;
    setState(usable && session ? { status: "ready", session } : { status: "empty" });
  }, [exam.examCode, questions]);

  if (state.status === "loading") {
    return <p className="text-muted">読み込んでいます…</p>;
  }

  if (state.status === "empty") {
    return (
      <EmptyState
        title="出題する問題がありません"
        description="モードを選んで、出題を始めてください。"
        action={{ label: "モード選択へ", href: `/exams/${exam.examCode}` }}
      />
    );
  }

  const { session } = state;
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const total = session.questionIds.length;
  const index = Math.min(session.index, total - 1);
  const question = byId.get(session.questionIds[index] as string) as Question;
  const selected = answerFor(session.answers, question.questionId);
  const isLast = index === total - 1;
  const needed = question.correctAnswers.length;

  function update(next: Session) {
    setSaveFailed(!saveSession(browserStore(), next));
    setState({ status: "ready", session: next });
  }

  function choose(key: string) {
    const next =
      question.questionType === "single"
        ? [key]
        : selected.includes(key)
          ? selected.filter((k) => k !== key)
          : sortKeys([...selected, key]);
    update({ ...session, answers: { ...session.answers, [question.questionId]: next } });
  }

  function move(delta: number) {
    update({ ...session, index: index + delta });
  }

  function finish() {
    const saved = saveResult(browserStore(), {
      examCode: exam.examCode,
      questionIds: session.questionIds,
      answers: session.answers,
      finishedAt: new Date().toISOString(),
      choiceOrder: session.choiceOrder,
    });
    if (!saved) {
      // 結果を残せないときは、回答を消さずに、この画面にとどまる
      setSaveFailed(true);
      return;
    }
    clearSession(browserStore(), exam.examCode);
    router.push(`/exams/${exam.examCode}/result`);
  }

  const inputType = question.questionType === "single" ? "radio" : "checkbox";

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <p className="text-sm text-muted">
          {exam.shortName} / {index + 1} / {total} 問目
        </p>
        <progress className="h-2 w-full accent-primary" value={index + 1} max={total} aria-label="進み具合" />
      </div>

      <fieldset aria-labelledby="question-text" className="space-y-3">
        <RichText id="question-text" text={question.questionText} className="text-lg font-bold" />
        <p className="text-sm text-muted">
          {question.questionType === "single" ? "1 つ選んでください。" : `${needed} つ選んでください。`}
        </p>
        {orderChoices(question, session.choiceOrder).map((choice) => (
          <label
            key={choice.key}
            className={`flex items-start gap-3 rounded-md border p-3 ${
              selected.includes(choice.key) ? "border-primary bg-surface" : "border-line bg-surface"
            }`}
          >
            <input
              type={inputType}
              name={question.questionId}
              className="mt-1 size-5"
              checked={selected.includes(choice.key)}
              onChange={() => choose(choice.key)}
            />
            <span>
              <span className="font-bold">{choice.key}. </span>
              <InlineText text={choice.text} />
            </span>
          </label>
        ))}
      </fieldset>

      {saveFailed ? (
        <p role="alert" className="text-incorrect">
          この端末では、回答を保存できません。ブラウザの設定を確認してください。
        </p>
      ) : null}

      <div className="flex gap-3">
        <button
          type="button"
          onClick={() => move(-1)}
          disabled={index === 0}
          className="rounded-md border border-line bg-surface px-5 py-3 font-bold disabled:opacity-50"
        >
          前の問題へ
        </button>
        {isLast ? (
          <button
            type="button"
            onClick={finish}
            disabled={selected.length === 0}
            className="flex-1 rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            採点する
          </button>
        ) : (
          <button
            type="button"
            onClick={() => move(1)}
            disabled={selected.length === 0}
            className="flex-1 rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            次の問題へ
          </button>
        )}
      </div>
    </section>
  );
}
