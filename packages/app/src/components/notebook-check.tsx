"use client";

import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { ChoiceChip } from "@/components/choice-review.tsx";
import { useNotebookProgress } from "@/components/notebook-progress.tsx";
import { InlineText } from "@/components/rich-text.tsx";
import type { TocDomain } from "@/lib/notebook-data.ts";
import {
  arrangeReview,
  choiceOrderOf,
  completableUnits,
  completedCount,
  completedDateLabel,
  continueUnit,
  gradeReview,
  type NotebookCheck,
  type NotebookCheckKey,
  type ReviewArrangement,
  type ReviewItem,
} from "@/lib/notebook-review.ts";
import { browserStore, loadSettings } from "@/lib/storage.ts";

/** 画面に出す記号は、表示の並びの位置で決める(入れ替えても、上が A、下が B) */
const POSITION_LABELS = ["A", "B"] as const;

/**
 * 2 択の問い。回答する前は、選択肢をラジオで選べる。回答したあとは、選択を変えられず、正誤の印と、選択肢ごとの理由を出す。
 * 正誤は、色だけでなく、文字(「正解」「あなたの回答」)と記号でも示す。
 */
function TwoChoice({
  name,
  check,
  order,
  selected,
  onSelect,
  revealed,
}: {
  name: string;
  check: NotebookCheck;
  order: readonly NotebookCheckKey[];
  selected: NotebookCheckKey | undefined;
  onSelect: (key: NotebookCheckKey) => void;
  revealed: boolean;
}) {
  const byKey = new Map(check.choices.map((choice) => [choice.key, choice]));
  return (
    <div className="space-y-2">
      {order.map((key, i) => {
        const choice = byKey.get(key);
        if (!choice) return null;
        const label = POSITION_LABELS[i] ?? key;
        const on = selected === key;
        const correct = check.correct === key;
        if (revealed) {
          const state = correct ? "correct" : on ? "wrong" : "plain";
          return (
            <div
              key={key}
              className={`flex items-start gap-3 rounded-md border p-3 ${
                correct
                  ? "border-correct bg-correct-bg"
                  : on
                    ? "border-incorrect bg-incorrect-bg"
                    : "border-line bg-surface"
              }`}
            >
              <ChoiceChip label={label} state={state} />
              <div className="min-w-0 space-y-1">
                <p className="flex flex-wrap items-center gap-2">
                  <span>
                    <InlineText text={choice.text} />
                  </span>
                  {correct ? <span className="chip tone-correct">○ 正解</span> : null}
                  {on ? <span className="chip tone-primary">あなたの回答</span> : null}
                </p>
                <p className="text-sm notebook-prose">
                  <InlineText text={choice.reason} />
                </p>
              </div>
            </div>
          );
        }
        return (
          <label
            key={key}
            className={`flex items-start gap-3 rounded-md border p-3 ${
              on ? "motion-select border-primary bg-soft" : "border-line bg-surface"
            } has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-primary`}
          >
            <input type="radio" name={name} className="sr-only" checked={on} onChange={() => onSelect(key)} />
            <ChoiceChip label={label} state={on ? "selected" : "plain"} />
            <span className="pt-0.5">
              <InlineText text={choice.text} />
            </span>
          </label>
        );
      })}
    </div>
  );
}

/** 正誤の表示。読み上げに伝え(`role="status"`)、確定したらフォーカスを移す(出題の画面と同じ) */
function Verdict({ correct, text, focus }: { correct: boolean; text: string; focus: number }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus > 0) ref.current?.focus();
  }, [focus]);
  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      className={`rounded-md border-l-4 p-3 font-bold ${
        correct
          ? "motion-correct border-correct bg-correct-bg text-correct"
          : "border-incorrect bg-incorrect-bg text-incorrect"
      }`}
    >
      {text}
    </div>
  );
}

/** 表示の設定の「選択肢の並びをシャッフルする」を、端末から読む(読めなければ既定) */
function useShuffleChoices(): boolean | null {
  const [shuffled, setShuffled] = useState<boolean | null>(null);
  useEffect(() => {
    try {
      setShuffled(loadSettings(browserStore()).shuffleChoices);
    } catch {
      setShuffled(false);
    }
  }, []);
  return shuffled;
}

/**
 * 見出しの確認の問い(2 択)。選んで「回答する」を押すと確定し、正誤と選択肢ごとの理由を出す。「もう一度」で未回答に戻る。
 * 選択肢の並びは、表示の設定の「選択肢の並びをシャッフルする」に従う。結果は保存しない。
 */
export function NotebookCheckItem({ id, check }: { id: string; check: NotebookCheck }) {
  const shuffled = useShuffleChoices();
  const [order, setOrder] = useState<NotebookCheckKey[]>(["A", "B"]);
  const [selected, setSelected] = useState<NotebookCheckKey | undefined>();
  const [revealed, setRevealed] = useState(false);
  const [focus, setFocus] = useState(0);
  const questionId = useId();

  useEffect(() => {
    if (shuffled !== null) setOrder(choiceOrderOf(shuffled, Math.random));
  }, [shuffled]);

  const correct = selected === check.correct;
  return (
    <fieldset className="card space-y-3 p-4" aria-labelledby={questionId}>
      <legend id={questionId} className="sr-only">
        <InlineText text={check.question} />
      </legend>
      <p aria-hidden="true" className="font-bold">
        <InlineText text={check.question} />
      </p>
      <TwoChoice
        name={`${id}-choice`}
        check={check}
        order={order}
        selected={selected}
        onSelect={setSelected}
        revealed={revealed}
      />
      {revealed ? (
        <>
          <Verdict correct={correct} text={correct ? "○ 正解です" : "× 不正解です"} focus={focus} />
          <button
            type="button"
            onClick={() => {
              setSelected(undefined);
              setRevealed(false);
              if (shuffled) setOrder(choiceOrderOf(true, Math.random));
            }}
            className="rounded-md border border-line px-4 py-2 text-sm font-bold"
          >
            もう一度
          </button>
        </>
      ) : (
        <button
          type="button"
          disabled={selected === undefined}
          onClick={() => {
            setRevealed(true);
            setFocus((n) => n + 1);
          }}
          className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
        >
          回答する
        </button>
      )}
    </fieldset>
  );
}

type RecordState = "idle" | "saving" | "saved" | "failed" | "preview";

/**
 * 中分類の末尾の「ここまでのおさらい」。その中分類の確認の問いをすべて並べ、全問を選んだら 1 つの「回答する」で確定する。
 * 1 回の通しで全問正解したときだけ、中分類を履修済みとして記録する(管理者のプレビューでは記録しない)。
 * やり直しでは、問いの並びと選択肢の並びを入れ替える(表示の設定によらない)。
 */
export function NotebookReview({ unitId, items }: { unitId: string; items: ReviewItem[] }) {
  const { preview, completed, record } = useNotebookProgress();
  // 最初の通しは、見出しの並び順のまま、選択肢の並びだけを入れ替える(描いたあとに決める。サーバーの描画と食い違わないように)
  const [arrangement, setArrangement] = useState<ReviewArrangement>(() => ({
    items,
    choiceOrder: Object.fromEntries(items.map((item) => [item.id, ["A", "B"] as NotebookCheckKey[]])),
  }));
  const [answers, setAnswers] = useState<Record<string, NotebookCheckKey | undefined>>({});
  const [revealed, setRevealed] = useState(false);
  const [focus, setFocus] = useState(0);
  const [recordState, setRecordState] = useState<RecordState>("idle");
  const headingId = useId();

  useEffect(() => {
    setArrangement(arrangeReview(items, Math.random, false));
  }, [items]);

  if (items.length === 0) return null;
  const unanswered = arrangement.items.filter((item) => answers[item.id] === undefined).length;
  const grade = gradeReview(arrangement.items, answers);
  const completedAt = completed?.get(unitId);

  async function save() {
    if (preview) {
      setRecordState("preview");
      return;
    }
    setRecordState("saving");
    setRecordState((await record(unitId)) ? "saved" : "failed");
  }

  function submit() {
    setRevealed(true);
    setFocus((n) => n + 1);
    if (gradeReview(arrangement.items, answers).allCorrect) void save();
  }

  function retry() {
    setArrangement(arrangeReview(items, Math.random, true));
    setAnswers({});
    setRevealed(false);
    setRecordState("idle");
  }

  return (
    <section aria-labelledby={headingId} className="space-y-4 border-t border-line pt-6">
      <div className="space-y-1">
        <h2 id={headingId} className="h2">
          ここまでのおさらい
        </h2>
        <p className="text-sm text-muted">
          この中分類の確認の問い {items.length} 問です。1 回の通しで全問に正解すると、履修済みとして記録します。
          {completedAt ? ` 履修済みです(${completedDateLabel(completedAt)})。何度でも解けます。` : ""}
        </p>
      </div>
      <ol className="space-y-4">
        {arrangement.items.map((item, i) => (
          <li key={item.id}>
            <fieldset className="card space-y-3 p-4" aria-labelledby={`${item.id}-review-q`}>
              <legend id={`${item.id}-review-q`} className="sr-only">
                問 {i + 1}: <InlineText text={item.check.question} />
              </legend>
              <p aria-hidden="true" className="text-xs text-muted">
                問 {i + 1} / {item.term}
              </p>
              <p aria-hidden="true" className="font-bold">
                <InlineText text={item.check.question} />
              </p>
              <TwoChoice
                name={`${item.id}-review`}
                check={item.check}
                order={arrangement.choiceOrder[item.id] ?? ["A", "B"]}
                selected={answers[item.id]}
                onSelect={(key) => setAnswers((current) => ({ ...current, [item.id]: key }))}
                revealed={revealed}
              />
              {revealed ? (
                <p
                  className={`font-bold ${answers[item.id] === item.check.correct ? "text-correct" : "text-incorrect"}`}
                >
                  {answers[item.id] === item.check.correct ? "○ 正解" : "× 不正解"}
                </p>
              ) : null}
            </fieldset>
          </li>
        ))}
      </ol>
      {revealed ? (
        <div className="space-y-3">
          <Verdict
            correct={grade.allCorrect}
            text={
              grade.allCorrect
                ? "○ 全問正解です"
                : `${grade.total} 問中 ${grade.correct} 問正解です。理由を読んでから、もう一度通しましょう`
            }
            focus={focus}
          />
          {grade.allCorrect ? <RecordStatus state={recordState} onRetry={() => void save()} /> : null}
          <button type="button" onClick={retry} className="rounded-md border border-line px-4 py-2 text-sm font-bold">
            もう一度通す
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={unanswered > 0}
            onClick={submit}
            className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            回答する
          </button>
          {unanswered > 0 ? <span className="text-sm text-muted">未選択 {unanswered} 問</span> : null}
        </div>
      )}
    </section>
  );
}

/** 履修済みの記録の状態。記録できなかったときは、もう一度記録できる */
function RecordStatus({ state, onRetry }: { state: RecordState; onRetry: () => void }) {
  return (
    <div aria-live="polite" className="text-sm">
      {state === "saving" ? <p className="text-muted">履修済みとして記録しています…</p> : null}
      {state === "saved" ? (
        <p className="font-bold text-correct">
          <span className="motion-stamp">✓</span> 履修済みとして記録しました
        </p>
      ) : null}
      {state === "preview" ? <p className="text-muted">プレビューでは記録しません。</p> : null}
      {state === "failed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-bold text-incorrect">記録できませんでした。通信の状態を確かめてください。</p>
          <button type="button" onClick={onRetry} className="rounded-md border border-line px-3 py-1 font-bold">
            もう一度記録する
          </button>
        </div>
      ) : null}
    </div>
  );
}

/** 中分類のページの題の近くに出す「✓ 履修済み(日付)」。読めないとき・履修していないときは出さない */
export function NotebookUnitCompleted({ unitId }: { unitId: string }) {
  const { completed } = useNotebookProgress();
  const at = completed?.get(unitId);
  if (!at) return null;
  return (
    <p>
      <span className="chip tone-correct">
        <span className="motion-stamp">✓</span> 履修済み({completedDateLabel(at)})
      </span>
    </p>
  );
}

/** 目次の中分類の「✓」。読み上げでは「履修済み」と読む */
export function NotebookTocMark({ unitId }: { unitId: string }) {
  const { completed } = useNotebookProgress();
  if (!completed?.has(unitId)) return null;
  return (
    <span className="text-correct">
      <span aria-hidden="true">✓</span>
      <span className="sr-only">(履修済み)</span>
    </span>
  );
}

/** 表紙の、全体の履修済みの数と「続きから」。読めないときは出さない */
export function NotebookCoverProgress({ toc, basePath }: { toc: TocDomain[]; basePath: string }) {
  const { completed } = useNotebookProgress();
  if (!completed) return null;
  const units = completableUnits(toc);
  if (units.length === 0) return null;
  const target = continueUnit(toc, completed);
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="font-bold">
        履修済み {completedCount(units, completed)} / {units.length}
      </p>
      {target === "all-done" ? (
        <p className="font-bold text-correct">✓ すべての中分類を履修しました</p>
      ) : target ? (
        <Link
          href={`${basePath}/${target.id}`}
          className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:opacity-90"
        >
          続きから: {target.number} {target.title}
        </Link>
      ) : null}
    </div>
  );
}

/** 表紙の分野のタイルの、分野の中の履修済みの数。読めないときは出さない */
export function NotebookDomainProgress({ domain }: { domain: TocDomain }) {
  const { completed } = useNotebookProgress();
  if (!completed) return null;
  const units = completableUnits([domain]);
  if (units.length === 0) return null;
  return (
    <span className="block text-sm text-muted">
      履修済み {completedCount(units, completed)} / {units.length}
    </span>
  );
}
