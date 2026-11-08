"use client";

import Link from "next/link";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useId, useRef, useState } from "react";
import { ChoiceChip } from "@/components/choice-review.tsx";
import { useNotebookProgress } from "@/components/notebook-progress.tsx";
import { InlineText } from "@/components/rich-text.tsx";
import type { TocDomain } from "@/lib/notebook-data.ts";
import {
  arrangeReview,
  choiceOrderOf,
  completedDateLabel,
  continueSection,
  domainProgress,
  gradeReview,
  hasEntryRecord,
  isEntryDone,
  type NotebookCheck,
  type NotebookCheckKey,
  overallProgress,
  type ReviewArrangement,
  type ReviewItem,
  type SectionUnit,
  unitProgress,
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
export function NotebookCheckItem({
  id,
  check,
  onResult,
}: {
  id: string;
  check: NotebookCheck;
  /** 回答を確定したとき、正解かどうかを伝える */
  onResult?: (correct: boolean) => void;
}) {
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
            onResult?.(correct);
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

type SectionScope = {
  /** この画面で、節のすべての問いに正解した(一度正解した問いは、もう一度で解き直しても、正解のまま数える) */
  allPassed: boolean;
  /** アカウントから読んだ記録で、この節が完了している(読み込み中と、読めないときは false) */
  done: boolean;
  state: RecordState;
  report: (index: number) => void;
  retry: () => void;
};

const ScopeContext = createContext<SectionScope | null>(null);

function useSectionScope(): SectionScope {
  const scope = useContext(ScopeContext);
  if (!scope) throw new Error("NotebookSectionScope の中で使う");
  return scope;
}

/**
 * 節 1 つの確認の状態を持つ(節ごとに作り直す: 呼び出し側で `key` を節の ID にする)。
 * 節のすべての問いに正解したら、節の完了を記録する(管理者のプレビューでは記録しない)。
 * すでに完了している節(旧い中分類の記録による完了を含む)は、記録の状態を「完了として記録しています」にし、
 * `PUT` の結果によらない。旧い中分類の記録だけで完了している節は、節の記録を書く。
 */
export function NotebookSectionScope({
  unitId,
  entryId,
  total,
  children,
}: {
  unitId: string;
  entryId: string;
  /** 節の確認の問いの数 */
  total: number;
  children: ReactNode;
}) {
  const { preview, records, record } = useNotebookProgress();
  const [passed, setPassed] = useState<ReadonlySet<number>>(new Set());
  const [state, setState] = useState<RecordState>("idle");
  const allPassed = total > 0 && passed.size >= total;
  const done = records ? isEntryDone(records, unitId, entryId) : false;

  const save = useCallback(async () => {
    setState("saving");
    setState((await record(unitId, entryId)) ? "saved" : "failed");
  }, [record, unitId, entryId]);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 全問に正解した、その一度だけ記録する
  useEffect(() => {
    if (!allPassed) return;
    if (preview) {
      setState("preview");
      return;
    }
    if (records && hasEntryRecord(records, unitId, entryId)) return;
    if (done) {
      void record(unitId, entryId);
      return;
    }
    void save();
  }, [allPassed]);

  const report = useCallback((index: number) => setPassed((current) => new Set(current).add(index)), []);
  const retry = useCallback(() => void save(), [save]);

  return <ScopeContext.Provider value={{ allPassed, done, state, report, retry }}>{children}</ScopeContext.Provider>;
}

/** 節の確認の問い(すべて)と、記録の状態 */
export function NotebookSectionChecks({ entryId, checks }: { entryId: string; checks: NotebookCheck[] }) {
  const scope = useSectionScope();
  return (
    <>
      {checks.map((check, i) => (
        <NotebookCheckItem
          // biome-ignore lint/suspicious/noArrayIndexKey: 見出しの中の問いの並びは固定(問いの番号が識別子)
          key={`${entryId}-${i + 1}`}
          id={`${entryId}-${i + 1}`}
          check={check}
          onResult={(correct) => {
            if (correct) scope.report(i);
          }}
        />
      ))}
      <RecordStatus />
    </>
  );
}

/** 記録の状態。記録できなかったときは、もう一度記録できる。読み込み中と読めないときは、正解のあとの記録の結果だけを出す */
function RecordStatus() {
  const { state, done, retry } = useSectionScope();
  return (
    <div aria-live="polite" className="text-sm">
      {state === "saving" ? <p className="text-muted">記録しています…</p> : null}
      {state === "saved" ? <p className="font-bold text-correct">完了として記録しました</p> : null}
      {state === "preview" ? <p className="text-muted">プレビューでは記録しません。</p> : null}
      {state === "failed" ? (
        <div className="flex flex-wrap items-center gap-3">
          <p className="font-bold text-incorrect">記録できませんでした。通信の状態を確かめてください。</p>
          <button type="button" onClick={retry} className="rounded-md border border-line px-3 py-1 font-bold">
            もう一度記録する
          </button>
        </div>
      ) : null}
      {state === "idle" && done ? <p className="font-bold text-correct">完了として記録しています</p> : null}
    </div>
  );
}

type SectionLink = { id: string; term: string };

/**
 * 節の前後への移動。前の節へは、いつでも戻れる。「次の節へ」は、この節の確認に正解したあと(すでに完了している節では、最初から)。
 * 最後の節には、次の節がないので出さない(比較の表とおさらいが続く)。
 */
export function NotebookSectionPager({
  basePath,
  unitId,
  prev,
  next,
}: {
  basePath: string;
  unitId: string;
  prev: SectionLink | null;
  next: SectionLink | null;
}) {
  const { allPassed, done } = useSectionScope();
  const showNext = next !== null && (allPassed || done);
  if (!prev && !showNext) return null;
  return (
    <nav aria-label="節の移動" className="grid gap-3 sm:grid-cols-2">
      {prev ? (
        <Link href={`${basePath}/${unitId}/${prev.id}`} className="card p-3 text-sm">
          <span className="block text-muted">← 前の節</span>
          <span className="block font-bold text-primary">{prev.term}</span>
        </Link>
      ) : (
        <span />
      )}
      {showNext && next ? (
        <Link href={`${basePath}/${unitId}/${next.id}`} className="card p-3 text-right text-sm">
          <span className="block text-muted">次の節へ →</span>
          <span className="block font-bold text-primary">{next.term}</span>
        </Link>
      ) : null}
    </nav>
  );
}

/**
 * 中分類の末尾の「ここまでのおさらい」(任意の総復習)。中分類のすべての節が完了したあとに出す。
 * その中分類の確認の問いをすべて並べ、全問を選んだら 1 つの「回答する」で確定する。結果は保存せず、履修済みの記録もしない。
 * やり直しでは、問いの並びと選択肢の並びを入れ替える(表示の設定によらない)。
 * 管理者のプレビューは、完了を読まないので、いつでも出す。
 */
export function NotebookReview({ unit, items }: { unit: SectionUnit; items: ReviewItem[] }) {
  const { preview, records } = useNotebookProgress();
  // 最初の通しは、見出しの並び順のまま、選択肢の並びだけを入れ替える(描いたあとに決める。サーバーの描画と食い違わないように)
  const [arrangement, setArrangement] = useState<ReviewArrangement>(() => ({
    items,
    choiceOrder: Object.fromEntries(items.map((item) => [item.id, ["A", "B"] as NotebookCheckKey[]])),
  }));
  const [answers, setAnswers] = useState<Record<string, NotebookCheckKey | undefined>>({});
  const [revealed, setRevealed] = useState(false);
  const [focus, setFocus] = useState(0);
  const headingId = useId();

  useEffect(() => {
    setArrangement(arrangeReview(items, Math.random, false));
  }, [items]);

  if (items.length === 0) return null;
  if (!preview && !(records && unitProgress(unit, records).completed)) return null;
  const unanswered = arrangement.items.filter((item) => answers[item.id] === undefined).length;
  const grade = gradeReview(arrangement.items, answers);

  function submit() {
    setRevealed(true);
    setFocus((n) => n + 1);
  }

  function retry() {
    setArrangement(arrangeReview(items, Math.random, true));
    setAnswers({});
    setRevealed(false);
  }

  return (
    <section aria-labelledby={headingId} className="space-y-4 border-t border-line pt-6">
      <div className="space-y-1">
        <h2 id={headingId} className="h2">
          ここまでのおさらい
        </h2>
        <p className="text-sm text-muted">
          この中分類の確認の問い {items.length}{" "}
          問を通して解く、任意の総復習です。解かなくても、すべての節の完了で履修済みになります。結果は保存しません。
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

/**
 * パンくずの下の行(どの節のページにも出る)の「✓ 完了」と「✓ 履修済み(日付)」。
 * 読み込み中と、読めないときと、管理者のプレビューでは出さない。
 */
export function NotebookSectionStatus({
  unitId,
  entryId,
  entryIds,
}: {
  unitId: string;
  entryId: string;
  /** 中分類の、画面に出す節の ID(目次の並び) */
  entryIds: readonly string[];
}) {
  const { records, lastRecorded } = useNotebookProgress();
  if (!records) return null;
  const entryDone = isEntryDone(records, unitId, entryId);
  const unit = unitProgress({ id: unitId, entries: entryIds.map((id) => ({ id })) }, records);
  if (!entryDone && !unit.completed) return null;
  // 押印の動きは、この画面で完了にした節のページだけで出す
  const stamp = lastRecorded?.unit === unitId && lastRecorded.entry === entryId ? "motion-stamp" : undefined;
  return (
    <p className="flex flex-wrap items-center gap-2">
      {entryDone ? (
        <span className="chip tone-correct">
          <span className={stamp}>✓</span> 完了
        </span>
      ) : null}
      {unit.completed ? (
        <span className="chip tone-correct">
          <span className={stamp}>✓</span> 履修済み{unit.completedAt ? `(${completedDateLabel(unit.completedAt)})` : ""}
        </span>
      ) : null}
    </p>
  );
}

/** 表紙の、全体の完了した節の数と履修済みの中分類の数、「続きから」。読み込み中と読めないときは出さない */
export function NotebookCoverProgress({ toc, basePath }: { toc: TocDomain[]; basePath: string }) {
  const { records } = useNotebookProgress();
  if (!records) return null;
  const overall = overallProgress(toc, records);
  if (overall.totalEntries === 0) return null;
  const target = continueSection(toc, records);
  return (
    <div className="card flex flex-wrap items-center justify-between gap-3 p-4">
      <p className="flex flex-wrap items-baseline gap-x-4 gap-y-1 font-bold">
        <span>
          {overall.doneEntries} / {overall.totalEntries} 節
        </span>
        <span>
          履修済み {overall.doneUnits} / {overall.totalUnits} 中分類
        </span>
      </p>
      {target === "all-done" ? (
        <p className="font-bold text-correct">✓ すべての節を完了しました</p>
      ) : target ? (
        <Link
          href={`${basePath}/${target.unit.id}/${target.entry.id}`}
          className="rounded-md bg-primary px-4 py-2 text-sm font-bold text-on-primary hover:opacity-90"
        >
          続きから: {target.unit.number} {target.unit.title} › {target.entry.term}
        </Link>
      ) : null}
    </div>
  );
}

/** 表紙の分野のタイルの、分野の中の履修済みの数。読み込み中と読めないときは出さない */
export function NotebookDomainProgress({ domain }: { domain: TocDomain }) {
  const { records } = useNotebookProgress();
  if (!records) return null;
  const { doneUnits, totalUnits } = domainProgress(domain, records);
  if (totalUnits === 0) return null;
  return (
    <span className="block text-sm text-muted">
      履修済み {doneUnits} / {totalUnits}
    </span>
  );
}
