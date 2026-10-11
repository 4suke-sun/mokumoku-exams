"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookmarkError, BookmarkToggle, useBookmarks } from "@/components/bookmark-toggle.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { InlineText, RichText } from "@/components/rich-text.tsx";
import { postServerResult } from "@/lib/history/client.ts";
import { type QuizKeyAction, quizKeyAction } from "@/lib/keyboard.ts";
import {
  answerFor,
  displayLabels,
  formatRemaining,
  hasText,
  keyForLabel,
  orderChoices,
  remainingMs,
  score,
  sortKeys,
  textAnswerFor,
} from "@/lib/quiz.ts";
import {
  browserStore,
  clearSession,
  loadSession,
  MAX_TEXT_ANSWER_LENGTH,
  type Session,
  saveResult,
  saveSession,
  saveStageCheck,
} from "@/lib/storage.ts";
import { isStagePassed } from "@/lib/study-stages.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";

type Props = {
  exam: PublishedExam;
  questions: Question[];
  /** いまの時刻を返す。本番モードの残り時間に使う(テストで固定できるように外から渡す) */
  clock?: () => Date;
};

const systemClock = () => new Date();
/** 本番モードの残り時間を数え直す間隔(ミリ秒) */
const TICK_MS = 1000;

type State = { status: "loading" } | { status: "empty" } | { status: "ready"; session: Session };

export function Player({ exam, questions, clock = systemClock }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [saveFailed, setSaveFailed] = useState(false);
  // キー操作は、描画のたびに作り直す最新の処理を呼ぶ(リスナーは付け直さない)
  const keyHandler = useRef<(action: QuizKeyAction) => void>(() => {});
  const choiceKeysRef = useRef<readonly string[]>([]);
  const questionRef = useRef<HTMLFieldSetElement>(null);
  const shownIndex = useRef<number | null>(null);
  const finishing = useRef(false);
  const bookmarks = useBookmarks(exam.examCode);
  // 時間切れの自動の採点は、描画のたびに作り直す最新の処理を呼ぶ。1 回だけ試みる
  const finishRef = useRef<() => Promise<void>>(async () => {});
  const autoFinished = useRef(false);
  const [now, setNow] = useState(clock);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = quizKeyAction(
        {
          key: event.key,
          ctrlKey: event.ctrlKey,
          metaKey: event.metaKey,
          altKey: event.altKey,
          targetTag: target?.tagName ?? "",
        },
        choiceKeysRef.current,
      );
      if (!action) return;
      event.preventDefault();
      keyHandler.current(action);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    const session = loadSession(browserStore(), exam.examCode);
    const ids = new Set(questions.map((q) => q.questionId));
    // 出題中の問題が、いまのデータにすべてあるときだけ続きから解く
    const usable = session?.questionIds.every((id) => ids.has(id)) === true;
    setState(usable && session ? { status: "ready", session } : { status: "empty" });
  }, [exam.examCode, questions]);

  // 本番モードは、締め切りまでの残り時間を数える。締め切りは出題の状態にあるので、再読み込みしても保たれる
  const deadline = state.status === "ready" ? state.session.deadline : undefined;
  useEffect(() => {
    if (deadline === undefined) return;
    setNow(clock());
    const timer = setInterval(() => setNow(clock()), TICK_MS);
    return () => clearInterval(timer);
  }, [deadline, clock]);
  const timeUp = deadline !== undefined && remainingMs(deadline, now) === 0;
  useEffect(() => {
    if (!timeUp || autoFinished.current) return;
    autoFinished.current = true;
    void finishRef.current();
  }, [timeUp]);

  const currentIndex = state.status === "ready" ? state.session.index : null;
  useEffect(() => {
    if (currentIndex === null) return;
    // 最初の表示では動かさず、問題が切り替わったときだけ、設問へフォーカスを移す(キーボードや読み上げで追えるように)
    if (shownIndex.current !== null && shownIndex.current !== currentIndex) questionRef.current?.focus();
    shownIndex.current = currentIndex;
  }, [currentIndex]);

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
  const text = textAnswerFor(session.textAnswers, question.questionId);
  const isLast = index === total - 1;
  const isFreeText = question.questionType === "free-text";
  // 時間切れのあとは、どの問題からでも採点へ進む
  const finishable = isLast || timeUp;

  function update(next: Session) {
    setSaveFailed(!saveSession(browserStore(), next));
    setState({ status: "ready", session: next });
  }

  function choose(key: string) {
    if (question.questionType === "free-text") return;
    const next =
      question.questionType === "single"
        ? [key]
        : selected.includes(key)
          ? selected.filter((k) => k !== key)
          : sortKeys([...selected, key]);
    update({ ...session, answers: { ...session.answers, [question.questionId]: next } });
  }

  function write(value: string) {
    update({ ...session, textAnswers: { ...session.textAnswers, [question.questionId]: value } });
  }

  function move(delta: number) {
    update({ ...session, index: index + delta });
  }

  async function finish() {
    if (finishing.current) return;
    finishing.current = true;
    try {
      const result = {
        examCode: exam.examCode,
        questionIds: session.questionIds,
        answers: session.answers,
        textAnswers: session.textAnswers,
        finishedAt: clock().toISOString(),
        choiceOrder: session.choiceOrder,
      };
      // アカウントに保存できたら、サーバーを正とする。保存できないとき(通信の失敗など)は、この端末に残して、あとで移せるようにする
      const posted = await postServerResult(result);
      if (!posted && !saveResult(browserStore(), result)) {
        // 結果を残せないときは、回答を消さずに、この画面にとどまる
        setSaveFailed(true);
        return;
      }
      if (session.stage) {
        // 段階の確認問題: 正答率で合否を決め、到達の状態を端末に残す(残せなくても、結果は保存済みなので先へ進む)
        const answered = session.questionIds.flatMap((id) => byId.get(id) ?? []);
        const { percent } = score(answered, session.answers, session.textAnswers);
        saveStageCheck(browserStore(), exam.examCode, {
          ...session.stage,
          percent,
          passed: isStagePassed(percent),
          finishedAt: result.finishedAt,
        });
      }
      clearSession(browserStore(), exam.examCode);
      router.push(`/exams/${exam.examCode}/result`);
    } finally {
      finishing.current = false;
    }
  }

  finishRef.current = finish;

  const choices = isFreeText ? [] : orderChoices(question, session.choiceOrder);
  // 時間切れのあとは、回答がなくても採点できる(自動の採点で保存できなかったときの、やり直し)
  const canAdvance = (isFreeText ? hasText(text) : selected.length > 0) || timeUp;

  // 画面の記号は、並べた順に A から振る。キー操作も、画面の記号で受ける
  const labels = displayLabels(choices);
  choiceKeysRef.current = [...labels.values()];
  const choiceKeysHint =
    choiceKeysRef.current.length > 1 ? `${choiceKeysRef.current[0]}〜${choiceKeysRef.current.at(-1)}` : "";
  keyHandler.current = (action) => {
    if (action.type === "choose") {
      const key = keyForLabel(labels, action.key);
      if (key !== undefined) choose(key);
    } else if (action.type === "previous") {
      if (index > 0) move(-1);
    } else if (canAdvance) {
      if (finishable) void finish();
      else move(1);
    }
  };

  return (
    <section className="space-y-6">
      <div className="space-y-2">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="text-sm text-muted" aria-live="polite">
            {exam.shortName} / {index + 1} / {total} 問目
          </p>
          {deadline !== undefined ? (
            <p className="text-sm font-bold">
              本番モード / 残り <span className="tabular-nums">{formatRemaining(remainingMs(deadline, now))}</span>
            </p>
          ) : null}
        </div>
        <progress className="h-2 w-full accent-primary" value={index + 1} max={total} aria-label="進み具合" />
        <div className="flex justify-end">
          <BookmarkToggle questionId={question.questionId} bookmarks={bookmarks} />
        </div>
        <BookmarkError bookmarks={bookmarks} />
      </div>

      <fieldset ref={questionRef} tabIndex={-1} aria-labelledby="question-text" className="space-y-3">
        <RichText id="question-text" text={question.questionText} className="text-lg font-bold" />
        {question.questionType === "free-text" ? (
          <>
            <p className="text-sm text-muted">文章で答えてください({MAX_TEXT_ANSWER_LENGTH} 文字まで)。</p>
            <textarea
              key={question.questionId}
              aria-label="回答"
              className="min-h-40 w-full rounded-md border border-line bg-surface p-3"
              maxLength={MAX_TEXT_ANSWER_LENGTH}
              value={text}
              onChange={(event) => write(event.target.value)}
            />
          </>
        ) : (
          <>
            <p className="text-sm text-muted">
              {question.questionType === "single"
                ? "1 つ選んでください。"
                : `${question.correctAnswers.length} つ選んでください。`}
            </p>
            {choices.map((choice) => (
              <label
                key={choice.key}
                className={`flex items-start gap-3 rounded-md border p-3 ${
                  selected.includes(choice.key) ? "border-primary bg-surface" : "border-line bg-surface"
                } has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary`}
              >
                <input
                  type={question.questionType === "single" ? "radio" : "checkbox"}
                  name={question.questionId}
                  className="mt-1 size-5"
                  checked={selected.includes(choice.key)}
                  onChange={() => choose(choice.key)}
                />
                <span>
                  <span className="font-bold">{labels.get(choice.key)}. </span>
                  <InlineText text={choice.text} />
                </span>
              </label>
            ))}
          </>
        )}
      </fieldset>

      <p className="text-sm text-muted">
        {isFreeText
          ? `キー操作: 入力欄の外で、Enter か N で${finishable ? "採点" : "次へ"} / P で前へ`
          : `キー操作: ${choiceKeysHint} で選ぶ / Enter か N で${finishable ? "採点" : "次へ"} / P で前へ`}
      </p>

      {timeUp ? (
        <p role="alert" className="font-bold">
          時間切れです。ここまでの回答で採点します。
        </p>
      ) : null}

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
        {finishable ? (
          <button
            type="button"
            onClick={() => void finish()}
            disabled={!canAdvance}
            className="flex-1 rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            採点する
          </button>
        ) : (
          <button
            type="button"
            onClick={() => move(1)}
            disabled={!canAdvance}
            className="flex-1 rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            次の問題へ
          </button>
        )}
      </div>
    </section>
  );
}
