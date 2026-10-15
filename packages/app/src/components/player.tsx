"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BookmarkError, BookmarkToggle, useBookmarks } from "@/components/bookmark-toggle.tsx";
import { ChoiceChip, ChoiceReview } from "@/components/choice-review.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { ExplanationView } from "@/components/explanation-view.tsx";
import { Notice } from "@/components/notice.tsx";
import { PlaySkeleton } from "@/components/page-skeletons.tsx";
import { QuestionChips } from "@/components/question-chips.tsx";
import { QuestionGrid } from "@/components/question-grid.tsx";
import { RecentMarks, useQuestionStats } from "@/components/question-stats.tsx";
import { InlineText, RichText } from "@/components/rich-text.tsx";
import { FreeTextScore } from "@/components/rubric-view.tsx";
import { type AnswerTimer, createTimer, elapsedTimes, setVisible, showQuestion } from "@/lib/answer-timer.ts";
import { recordSessionChecks, resultOf, saveFinishedResult } from "@/lib/finish-session.ts";
import { postServerResult, putSectionProgress } from "@/lib/history/client.ts";
import { type QuizKeyAction, type QuizKeyPhase, quizKeyAction } from "@/lib/keyboard.ts";
import {
  answerFor,
  displayLabels,
  formatRemaining,
  hasText,
  isQuestionCorrect,
  keyForLabel,
  labelKeys,
  orderChoices,
  remainingMs,
  sortKeys,
  textAnswerFor,
} from "@/lib/quiz.ts";
import {
  browserStore,
  clearSession,
  loadSession,
  MAX_TEXT_ANSWER_LENGTH,
  type Session,
  saveSession,
} from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { useStorageOwner } from "@/lib/use-storage-owner.ts";

type Props = {
  exam: PublishedExam;
  questions: Question[];
  /** いまの時刻を返す。本番モードの残り時間と回答時間に使う(テストで固定できるように外から渡す) */
  clock?: () => Date;
};

const systemClock = () => new Date();
/** 本番モードの残り時間を数え直す間隔(ミリ秒) */
const TICK_MS = 1000;
/** 残り時間がこれ以下になったら、「残りわずか」として赤で示す(ミリ秒) */
export const LOW_TIME_MS = 5 * 60_000;

type State = { status: "loading" } | { status: "empty" } | { status: "ready"; session: Session };

/** 問題ごとの印の配列を、出題の数にそろえる(持たないときは、すべて false) */
function marksOf(list: readonly boolean[] | undefined, total: number): boolean[] {
  return Array.from({ length: total }, (_, i) => list?.[i] === true);
}

function isVisible(): boolean {
  return typeof document === "undefined" || document.visibilityState !== "hidden";
}

export function Player({ exam, questions, clock = systemClock }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const owner = useStorageOwner();
  const [saveFailed, setSaveFailed] = useState(false);
  // キー操作は、描画のたびに作り直す最新の処理を呼ぶ(リスナーは付け直さない)
  const keyHandler = useRef<(action: QuizKeyAction, key: string) => void>(() => {});
  const choiceKeysRef = useRef<readonly string[]>([]);
  const phaseRef = useRef<QuizKeyPhase>("answering");
  const questionRef = useRef<HTMLFieldSetElement>(null);
  const verdictRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const shownIndex = useRef<number | null>(null);
  const finishing = useRef(false);
  const timer = useRef<AnswerTimer>(createTimer([]));
  const bookmarks = useBookmarks(exam.examCode);
  const stats = useQuestionStats(exam.examCode, questions);
  // 時間切れの自動の採点は、描画のたびに作り直す最新の処理を呼ぶ。1 回だけ試みる
  const finishRef = useRef<() => Promise<void>>(async () => {});
  const autoFinished = useRef(false);
  const [now, setNow] = useState(clock);
  // 問題カードのスライドの向き(最初の表示では動かさない)
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  // 未回答があるまま採点しようとしたときの確認
  const [confirming, setConfirming] = useState(false);
  // 「回答する」を押したあとに、正誤のバナーへフォーカスを移す
  const [verdictFocus, setVerdictFocus] = useState(0);

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
        phaseRef.current,
      );
      if (!action) return;
      event.preventDefault();
      keyHandler.current(action, event.key);
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    // 持ち主の印が取れるまでは、端末の記録を読まない(印が取れたら、読み直す)
    if (owner === undefined) return;
    const session = loadSession(browserStore(), exam.examCode);
    const ids = new Set(questions.map((q) => q.questionId));
    // 出題中の問題が、いまのデータにすべてあるときだけ続きから解く
    const usable = session?.questionIds.every((id) => ids.has(id)) === true;
    if (usable && session) timer.current = createTimer(session.timesMs ?? []);
    setState(usable && session ? { status: "ready", session } : { status: "empty" });
  }, [exam.examCode, questions, owner]);

  // タブが隠れている間は、回答時間を数えない
  useEffect(() => {
    function onVisibility() {
      timer.current = setVisible(timer.current, isVisible(), clock().getTime());
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [clock]);

  // 本番モードは、締め切りまでの残り時間を数える。締め切りは出題の状態にあるので、再読み込みしても保たれる
  const deadline = state.status === "ready" ? state.session.deadline : undefined;
  useEffect(() => {
    if (deadline === undefined) return;
    setNow(clock());
    const tick = setInterval(() => setNow(clock()), TICK_MS);
    return () => clearInterval(tick);
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
    timer.current = showQuestion(timer.current, currentIndex, isVisible(), clock().getTime());
    // 最初の表示では動かさず、問題が切り替わったときだけ、設問へフォーカスを移す(キーボードや読み上げで追えるように)
    if (shownIndex.current !== null && shownIndex.current !== currentIndex) questionRef.current?.focus();
    shownIndex.current = currentIndex;
  }, [currentIndex, clock]);

  useEffect(() => {
    if (verdictFocus > 0) verdictRef.current?.focus();
  }, [verdictFocus]);

  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  if (state.status === "loading") {
    return <PlaySkeleton />;
  }

  if (state.status === "empty") {
    return (
      <EmptyState
        icon="📝"
        headingLevel={1}
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
  const revealEach = session.reveal === "each";
  const checked = marksOf(session.checked, total);
  const unsure = marksOf(session.unsure, total);
  const flagged = marksOf(session.flagged, total);
  const isChecked = revealEach && checked[index] === true;
  const answeredList = session.questionIds.map(
    (id) => answerFor(session.answers, id).length > 0 || hasText(textAnswerFor(session.textAnswers, id)),
  );
  const answered = answeredList[index] === true;
  const unansweredCount = answeredList.filter((a) => !a).length;
  // 時間切れのあとは、どの問題からでも採点へ進む
  const finishable = isLast || timeUp;

  function update(next: Session) {
    const saved = { ...next, timesMs: elapsedTimes(timer.current, next.questionIds.length, clock().getTime()) };
    setSaveFailed(!saveSession(browserStore(), saved));
    setState({ status: "ready", session: saved });
  }

  function choose(key: string) {
    if (question.questionType === "free-text" || isChecked) return;
    const next =
      question.questionType === "single"
        ? [key]
        : selected.includes(key)
          ? selected.filter((k) => k !== key)
          : sortKeys([...selected, key]);
    update({ ...session, answers: { ...session.answers, [question.questionId]: next } });
  }

  function write(value: string) {
    if (isChecked) return;
    update({ ...session, textAnswers: { ...session.textAnswers, [question.questionId]: value } });
  }

  function goTo(target: number) {
    if (target === index || target < 0 || target >= total) return;
    setDirection(target > index ? "next" : "prev");
    setConfirming(false);
    update({ ...session, index: target });
  }

  /** 1 問ごとの表示で、回答を確定して、正誤と解説を出す */
  function submit() {
    if (!revealEach || isChecked || !answered) return;
    const next = [...checked];
    next[index] = true;
    update({ ...session, checked: next });
    setVerdictFocus((n) => n + 1);
  }

  function toggleMark(field: "unsure" | "flagged") {
    const next = field === "unsure" ? [...unsure] : [...flagged];
    next[index] = !next[index];
    update({ ...session, [field]: next });
  }

  /** 採点へ進む。未回答があるときは、先に確認する(時間切れのときは、確認せずに採点する) */
  function requestFinish() {
    if (unansweredCount > 0 && !timeUp && !confirming) {
      setConfirming(true);
      return;
    }
    void finish();
  }

  async function finish() {
    if (finishing.current) return;
    finishing.current = true;
    try {
      const result = resultOf(session, {
        finishedAt: clock(),
        timesMs: elapsedTimes(timer.current, total, clock().getTime()),
        unsure,
        flagged,
      });
      const store = browserStore();
      if ((await saveFinishedResult(store, result, postServerResult)) === "failed") {
        // 結果を残せないときは、回答を消さずに、この画面にとどまる
        setSaveFailed(true);
        return;
      }
      const asked = session.questionIds.flatMap((id) => byId.get(id) ?? []);
      recordSessionChecks(store, session, asked, result.finishedAt, putSectionProgress);
      clearSession(browserStore(), exam.examCode);
      router.push(`/exams/${exam.examCode}/result`);
    } finally {
      finishing.current = false;
    }
  }

  finishRef.current = finish;

  /** 次へ進む。最後の問題では採点へ */
  function advance() {
    if (finishable) requestFinish();
    else goTo(index + 1);
  }

  const choices = isFreeText ? [] : orderChoices(question, session.choiceOrder);

  // 画面の記号は、並べた順に A から振る。キー操作も、画面の記号で受ける
  const labels = displayLabels(choices);
  choiceKeysRef.current = [...labels.values()];
  phaseRef.current = revealEach ? (isChecked ? "checked" : "checking") : "answering";
  const choiceKeysHint =
    choiceKeysRef.current.length > 1
      ? `${choiceKeysRef.current[0]}〜${choiceKeysRef.current.at(-1)} で選ぶ(数字の 1〜${choiceKeysRef.current.length} でも選べる)`
      : "";
  keyHandler.current = (action, key) => {
    if (action.type === "choose") {
      const original = keyForLabel(labels, action.key);
      if (original !== undefined) choose(original);
    } else if (action.type === "submit") {
      submit();
    } else if (action.type === "previous") {
      if (index > 0) goTo(index - 1);
    } else if (key === "Enter" && !answered && !timeUp && !isChecked) {
      // Enter は、回答してから進む(回答せずに飛ばすときは、N か「次の問題へ」)
    } else {
      advance();
    }
  };

  const remaining = deadline !== undefined ? remainingMs(deadline, now) : null;
  const lowTime = remaining !== null && remaining <= LOW_TIME_MS;
  const correctNow = isChecked && isQuestionCorrect(question, session.answers, session.textAnswers);
  const enterHint = revealEach
    ? isChecked
      ? `Enter で${finishable ? "採点" : "次へ"}`
      : "Enter で回答する"
    : `Enter で${finishable ? "採点" : "次へ"}(回答してから)`;

  return (
    <section className="space-y-6 lg:grid lg:grid-cols-[minmax(0,1fr)_15rem] lg:items-start lg:gap-6 lg:space-y-0 xl:grid-cols-[minmax(0,1fr)_17rem] xl:gap-10">
      <div className="min-w-0 space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-muted" aria-live="polite">
              {exam.shortName} / {index + 1} / {total} 問目
            </p>
            {remaining !== null ? (
              <p className={`timer-pill ${lowTime ? "timer-pill-low" : ""}`}>
                <span aria-hidden="true">⏱</span>
                本番モード / 残り <span className="tabular-nums">{formatRemaining(remaining)}</span>
                {timeUp ? "(時間切れ)" : lowTime ? "(残りわずか)" : null}
              </p>
            ) : null}
          </div>
          <div
            role="progressbar"
            aria-label="進み具合"
            aria-valuemin={0}
            aria-valuemax={total}
            aria-valuenow={index + 1}
            aria-valuetext={`${index + 1} / ${total} 問目`}
            className="h-2 w-full overflow-hidden rounded-full bg-line"
          >
            <div
              className="motion-bar bg-accent-gradient h-full rounded-full"
              style={{ width: `${((index + 1) / total) * 100}%` }}
            />
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <QuestionChips domains={exam.domains} question={question} />
            <div className="flex flex-wrap items-center gap-2">
              <BookmarkToggle questionId={question.questionId} bookmarks={bookmarks} />
              <button
                type="button"
                aria-pressed={unsure[index]}
                onClick={() => toggleMark("unsure")}
                className={`rounded-full border px-3 py-1 text-sm font-bold ${
                  unsure[index] ? "border-warn bg-warn-bg text-warn" : "border-line"
                }`}
              >
                <span aria-hidden="true">{unsure[index] ? "? " : ""}</span>
                自信なし
              </button>
              <button
                type="button"
                aria-pressed={flagged[index]}
                onClick={() => toggleMark("flagged")}
                className={`rounded-full border px-3 py-1 text-sm font-bold ${
                  flagged[index] ? "border-orange bg-orange-soft text-orange" : "border-line"
                }`}
              >
                <span aria-hidden="true">{flagged[index] ? "● " : ""}</span>
                見直し
              </button>
            </div>
          </div>
          {stats ? <RecentMarks recent={stats.get(question.questionId)?.recent ?? []} /> : null}
          <BookmarkError bookmarks={bookmarks} />
        </div>

        <fieldset
          key={question.questionId}
          ref={questionRef}
          tabIndex={-1}
          aria-labelledby="question-text"
          className={`space-y-3 xl:space-y-4 ${direction === "next" ? "motion-slide-next" : direction === "prev" ? "motion-slide-prev" : ""}`}
        >
          <RichText
            id="question-text"
            text={question.questionText}
            className="text-lg font-bold xl:text-xl xl:leading-relaxed"
          />
          {question.questionType === "free-text" ? (
            <>
              <p className="text-sm text-muted">文章で答えてください({MAX_TEXT_ANSWER_LENGTH} 文字まで)。</p>
              <textarea
                key={question.questionId}
                aria-label="回答"
                className="min-h-40 w-full rounded-md border border-line bg-surface p-3"
                maxLength={MAX_TEXT_ANSWER_LENGTH}
                value={text}
                readOnly={isChecked}
                onChange={(event) => write(event.target.value)}
              />
            </>
          ) : isChecked ? (
            <ChoiceReview question={question} selected={selected} choiceOrder={session.choiceOrder} />
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
                    className={`flex items-start gap-3 rounded-md border p-3 xl:p-4 xl:text-lg ${
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

        {isChecked ? (
          <div className="space-y-3">
            <div
              ref={verdictRef}
              tabIndex={-1}
              className={`rounded-md border-l-4 p-3 font-bold ${
                correctNow
                  ? "border-correct bg-correct-bg text-correct"
                  : "border-incorrect bg-incorrect-bg text-incorrect"
              }`}
            >
              {correctNow
                ? "○ 正解です"
                : question.questionType === "free-text"
                  ? "× 採点基準を満たしていません"
                  : `× 不正解です。正解は ${labelKeys(question.correctAnswers, labels).join("、")} です`}
              {unsure[index] ? <span className="ml-2 text-sm text-fg">(自信なしの印は、復習に残します)</span> : null}
            </div>
            {question.questionType === "free-text" ? <FreeTextScore rubric={question.rubric} answer={text} /> : null}
            <details className="card p-3">
              <summary className="cursor-pointer font-bold">解説を見る</summary>
              <div className="mt-3">
                <ExplanationView question={question} choiceOrder={session.choiceOrder} />
              </div>
            </details>
          </div>
        ) : null}

        <p className="text-sm text-muted">
          {isFreeText
            ? `キー操作: 入力欄の外で、${enterHint} / N で${finishable ? "採点" : "次へ"} / P で前へ`
            : `キー操作: ${isChecked ? "" : `${choiceKeysHint} / `}${enterHint} / N で${finishable ? "採点" : "次へ"} / P で前へ`}
        </p>

        {timeUp ? <Notice kind="error">時間切れです。ここまでの回答で採点します。</Notice> : null}

        {saveFailed ? (
          <Notice kind="error">この端末では、回答を保存できません。ブラウザの設定を確認してください。</Notice>
        ) : null}

        {confirming ? (
          <div ref={confirmRef} tabIndex={-1} className="space-y-3">
            <Notice kind="error">
              未回答が {unansweredCount} 問あります。未回答の問題は、不正解として採点します。
            </Notice>
            <div className="flex flex-wrap gap-3">
              <button
                type="button"
                onClick={() => void finish()}
                className="rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
              >
                このまま採点する
              </button>
              <button
                type="button"
                onClick={() => {
                  setConfirming(false);
                  const first = answeredList.indexOf(false);
                  if (first >= 0) goTo(first);
                }}
                className="rounded-md border border-line bg-surface px-5 py-3 font-bold"
              >
                未回答の問題へ戻る
              </button>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={() => goTo(index - 1)}
            disabled={index === 0}
            className="rounded-md border border-line bg-surface px-5 py-3 font-bold disabled:opacity-50"
          >
            前の問題へ
          </button>
          {revealEach && !isChecked ? (
            <button
              type="button"
              onClick={submit}
              disabled={!answered}
              className="flex-1 rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
            >
              回答する
            </button>
          ) : null}
          {finishable ? (
            <button
              type="button"
              onClick={requestFinish}
              className={`flex-1 rounded-md px-5 py-3 font-bold ${
                revealEach && !isChecked
                  ? "border border-line bg-surface"
                  : "bg-primary text-on-primary hover:opacity-90"
              }`}
            >
              採点する
            </button>
          ) : (
            <button
              type="button"
              onClick={() => goTo(index + 1)}
              className={`flex-1 rounded-md px-5 py-3 font-bold ${
                revealEach && !isChecked
                  ? "border border-line bg-surface"
                  : "bg-primary text-on-primary hover:opacity-90"
              }`}
            >
              {answered || isChecked ? "次の問題へ" : "回答せずに次へ"}
            </button>
          )}
        </div>

        <p>
          <button
            type="button"
            onClick={() => router.push(`/exams/${exam.examCode}`)}
            className="text-sm text-primary underline"
          >
            中断する(ここまでの回答は保存され、モード選択の「前回の続きから」で再開できます)
          </button>
        </p>
      </div>

      <aside className="lg:sticky lg:top-4">
        <QuestionGrid total={total} current={index} answered={answeredList} flagged={flagged} onSelect={goTo} />
      </aside>
    </section>
  );
}
