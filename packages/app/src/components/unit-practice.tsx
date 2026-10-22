"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ChoiceChip, ChoiceReview } from "@/components/choice-review.tsx";
import { ExplanationView } from "@/components/explanation-view.tsx";
import { Notice } from "@/components/notice.tsx";
import { QuestionChips } from "@/components/question-chips.tsx";
import { ReferenceList } from "@/components/reference-list.tsx";
import { InlineText, RichText } from "@/components/rich-text.tsx";
import { ScoreRing } from "@/components/score-ring.tsx";
import { type AnswerTimer, createTimer, elapsedTimes, setVisible, showQuestion } from "@/lib/answer-timer.ts";
import { saveFinishedResult } from "@/lib/finish-session.ts";
import { postServerResult } from "@/lib/history/client.ts";
import { displayLabels, isCorrect, labelKeys, orderChoices, resultDetailHref, score, sortKeys } from "@/lib/quiz.ts";
import { browserStore, type Result } from "@/lib/storage.ts";
import type { NextStep } from "@/lib/study-nav.ts";
import type { ChoiceQuestion, PublishedExam } from "@/lib/types.ts";

type Props = {
  exam: Pick<PublishedExam, "examCode" | "domains">;
  /** 単元の問題(択一・複数選択。この順に出題する) */
  questions: ChoiceQuestion[];
  /** 単元を終えたあとに進む先 */
  next: NextStep;
};

type Phase =
  | { name: "intro" }
  | { name: "playing" }
  // saved: アカウントに保存できたか。local は、この端末にだけ残した。failed は、どちらにも残せなかった
  | { name: "done"; result: Result; saved: "server" | "local" | "failed" };

/**
 * 学習モードの、単元の問題をその場で 1 問ずつ解く部品。回答すると、すぐに正誤と解説を出す
 * (1 問ごとの解答の表示と同じ部品: ChoiceReview・ExplanationView)。
 * 正解のときは弾む動き、不正解のときは揺れる動きを付ける(動きを減らす設定とシンプル表示では、止まる)。
 * 解き終えたら、通常の出題と同じ結果として保存し(復習プールや学習の状況に反映される)、次の単元・次の分野・分野の一覧へ進める。
 */
export function UnitPractice({ exam, questions, next }: Props) {
  const [phase, setPhase] = useState<Phase>({ name: "intro" });
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [checked, setChecked] = useState(false);
  const [streak, setStreak] = useState(0);
  const [bestStreak, setBestStreak] = useState(0);
  const timer = useRef<AnswerTimer>(createTimer([]));
  // 回答したあとは、解説を読む時間を数えない
  const counting = useRef(false);
  const questionRef = useRef<HTMLFieldSetElement>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const [focusTarget, setFocusTarget] = useState<"question" | "verdict" | null>(null);

  const question = questions[index];
  const playing = phase.name === "playing";

  // 問題を表示したら、その問題の回答時間を数え始める。タブが隠れている間は数えない
  useEffect(() => {
    if (!playing) return;
    counting.current = true;
    timer.current = showQuestion(timer.current, index, !document.hidden, Date.now());
  }, [playing, index]);

  useEffect(() => {
    if (!playing) return;
    const onVisibility = () => {
      if (counting.current) timer.current = setVisible(timer.current, !document.hidden, Date.now());
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [playing]);

  // 回答したら正誤の表示へ、次の問題へ進んだら問題へ、フォーカスを移す(キーボードや読み上げで、続けて操作できるように)
  useEffect(() => {
    if (focusTarget === "verdict") verdictRef.current?.focus();
    if (focusTarget === "question") questionRef.current?.focus();
    setFocusTarget(null);
  }, [focusTarget]);

  if (questions.length === 0) {
    return (
      <button
        type="button"
        disabled
        className="w-full rounded-md bg-primary px-5 py-3 font-bold text-on-primary opacity-50"
      >
        この単元の問題を解く(0 問)
      </button>
    );
  }

  function begin() {
    timer.current = createTimer([]);
    setAnswers({});
    setIndex(0);
    setChecked(false);
    setStreak(0);
    setBestStreak(0);
    setPhase({ name: "playing" });
    setFocusTarget("question");
  }

  if (phase.name === "intro") {
    return (
      <button
        type="button"
        onClick={begin}
        className="w-full rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
      >
        この単元の問題を解く({questions.length} 問)
      </button>
    );
  }

  if (phase.name === "done") {
    const { result, saved } = phase;
    const { total, correct, percent } = score(questions, result.answers);
    return (
      <section aria-labelledby="practice_done-title" className="card space-y-4 p-4">
        <h2 id="practice_done-title" className="text-xl font-bold">
          単元の問題を解き終えました
        </h2>
        <div className="flex flex-col items-center gap-4 sm:flex-row">
          <ScoreRing percent={percent} reached={percent >= 80} />
          <div className="space-y-1">
            <p>
              {total} 問中 {correct} 問が正解です。
            </p>
            {bestStreak >= 2 ? <p className="text-sm text-muted">最大 {bestStreak} 連続正解でした。</p> : null}
          </div>
        </div>
        {saved === "local" ? (
          <Notice kind="info">アカウントに保存できなかったため、この端末に結果を残しました。</Notice>
        ) : null}
        {saved === "failed" ? (
          <Notice kind="error">結果を保存できませんでした。ブラウザの設定や通信を確認してください。</Notice>
        ) : null}
        <div className="flex flex-wrap gap-3">
          {next.nextUnit ? (
            <Link
              href={next.nextUnit.href}
              className="rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
            >
              次の単元へ({next.nextUnit.title})
            </Link>
          ) : null}
          {next.nextDomain ? (
            <Link
              href={next.nextDomain.href}
              className="rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
            >
              次の分野へ({next.nextDomain.name})
            </Link>
          ) : null}
          <Link href={next.listHref} className="rounded-md border border-line bg-surface px-5 py-3 font-bold">
            分野の一覧へ
          </Link>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          <button type="button" onClick={begin} className="text-primary hover:underline">
            この単元をもう一度解く
          </button>
          {saved !== "failed" ? (
            <Link href={resultDetailHref(exam.examCode, result.finishedAt)} className="text-primary hover:underline">
              結果の詳しい画面を見る
            </Link>
          ) : null}
        </div>
      </section>
    );
  }

  if (!question) return null;

  const choices = orderChoices(question);
  const labels = displayLabels(choices);
  const selected = answers[question.questionId] ?? [];
  const correctNow = isCorrect(question, selected);
  const isLast = index === questions.length - 1;

  function choose(key: string) {
    if (checked || !question) return;
    const current = answers[question.questionId] ?? [];
    const nextKeys =
      question.questionType === "single"
        ? [key]
        : current.includes(key)
          ? current.filter((k) => k !== key)
          : sortKeys([...current, key]);
    setAnswers({ ...answers, [question.questionId]: nextKeys });
  }

  /** 回答を確定して、正誤と解説を出す */
  function submit() {
    if (checked || selected.length === 0) return;
    // 回答にかかった時間は、ここまで。解説を読む時間は数えない
    timer.current = setVisible(timer.current, false, Date.now());
    counting.current = false;
    const nextStreak = correctNow ? streak + 1 : 0;
    setStreak(nextStreak);
    setBestStreak(Math.max(bestStreak, nextStreak));
    setChecked(true);
    setFocusTarget("verdict");
  }

  async function advance() {
    if (!checked) return;
    if (!isLast) {
      setIndex(index + 1);
      setChecked(false);
      setFocusTarget("question");
      return;
    }
    const result: Result = {
      examCode: exam.examCode,
      questionIds: questions.map((q) => q.questionId),
      answers,
      finishedAt: new Date().toISOString(),
      timesMs: elapsedTimes(timer.current, questions.length, Date.now()),
    };
    // アカウントに保存できたら、サーバーを正とする。できないときは、この端末に残して、あとで移せるようにする
    const saved = await saveFinishedResult(browserStore(), result, postServerResult);
    setPhase({ name: "done", result, saved });
  }

  return (
    <section aria-label="単元の問題" className="card space-y-4 p-4">
      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted" aria-live="polite">
            {index + 1} / {questions.length} 問目
          </p>
          {streak >= 2 ? (
            <p className="chip tone-correct" aria-live="polite">
              <span aria-hidden="true">🔥</span>
              {streak} 連続正解
            </p>
          ) : null}
        </div>
        <div
          role="progressbar"
          aria-label="進み具合"
          aria-valuemin={0}
          aria-valuemax={questions.length}
          aria-valuenow={index + 1}
          aria-valuetext={`${index + 1} / ${questions.length} 問目`}
          className="h-2 w-full overflow-hidden rounded-full bg-line"
        >
          <div
            className="motion-bar bg-accent-gradient h-full rounded-full"
            style={{ width: `${((index + 1) / questions.length) * 100}%` }}
          />
        </div>
        <QuestionChips domains={exam.domains} question={question} />
      </div>

      <fieldset
        key={question.questionId}
        ref={questionRef}
        tabIndex={-1}
        aria-labelledby="practice-question"
        className="space-y-3"
      >
        <RichText id="practice-question" text={question.questionText} className="text-lg font-bold" />
        {checked ? (
          <ChoiceReview question={question} selected={selected} />
        ) : (
          <>
            <p className="text-sm text-muted">
              {question.questionType === "single"
                ? "1 つ選んでください。"
                : `${question.correctAnswers.length} つ選んでください。`}
            </p>
            {choices.map((choice) => {
              const on = selected.includes(choice.key);
              return (
                <label
                  key={choice.key}
                  className={`flex items-start gap-3 rounded-md border p-3 ${
                    on ? "motion-select border-primary bg-soft" : "border-line bg-surface"
                  } has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary`}
                >
                  <input
                    type={question.questionType === "single" ? "radio" : "checkbox"}
                    name={question.questionId}
                    className="sr-only"
                    checked={on}
                    onChange={() => choose(choice.key)}
                  />
                  <ChoiceChip label={labels.get(choice.key) ?? choice.key} state={on ? "selected" : "plain"} />
                  <span className="pt-0.5">
                    <InlineText text={choice.text} />
                  </span>
                </label>
              );
            })}
          </>
        )}
      </fieldset>

      {checked ? (
        <div className="space-y-3">
          <div
            ref={verdictRef}
            tabIndex={-1}
            className={`rounded-md border-l-4 p-3 font-bold ${
              correctNow
                ? "motion-correct border-correct bg-correct-bg text-correct"
                : "motion-wrong border-incorrect bg-incorrect-bg text-incorrect"
            }`}
          >
            {correctNow
              ? "○ 正解です"
              : `× 不正解です。正解は ${labelKeys(question.correctAnswers, labels).join("、")} です`}
          </div>
          <details open className="card p-3">
            <summary className="cursor-pointer font-bold">解説</summary>
            <div className="mt-3">
              <ExplanationView question={question} />
            </div>
            <div className="mt-3">
              <ReferenceList references={question.references} />
            </div>
          </details>
        </div>
      ) : null}

      {checked ? (
        <button
          type="button"
          onClick={() => void advance()}
          className="w-full rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
        >
          {isLast ? "結果を見る" : "次の問題へ"}
        </button>
      ) : (
        <button
          type="button"
          onClick={submit}
          disabled={selected.length === 0}
          className="w-full rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
        >
          回答する
        </button>
      )}
    </section>
  );
}
