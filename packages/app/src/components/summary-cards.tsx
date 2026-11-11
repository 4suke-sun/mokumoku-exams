"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { ChoiceChip } from "@/components/choice-review.tsx";
import { QuestionChips } from "@/components/question-chips.tsx";
import { InlineText } from "@/components/rich-text.tsx";
import type { SummaryCardView } from "@/lib/summary-data.ts";
import { stepIndex, summaryKeyAction } from "@/lib/summary-keys.ts";
import type { PublishedExam } from "@/lib/types.ts";

type Props = {
  exam: Pick<PublishedExam, "examCode" | "name" | "domains">;
  cards: SummaryCardView[];
};

/**
 * 要約カードで直前チェックをする画面。1 枚ずつ、問いを見て、「答えを見る」で答えと決め手を開く。
 * 前へ・次へで巡回する(最後の次は最初へ戻る)。広い画面は、問いと答えを左右に並べる。
 * キーボード: N か → で次へ、P か ← で前へ、A か Enter で答えの開閉(lib/summary-keys.ts)。
 * カードを切り替える動きは、動きを減らす設定とシンプル表示では止まる(.motion-slide-*)。
 */
export function SummaryCards({ exam, cards }: Props) {
  const [index, setIndex] = useState(0);
  const [open, setOpen] = useState(false);
  const [direction, setDirection] = useState<"next" | "prev" | null>(null);
  const answerId = useId();
  const card = cards[index];

  function go(step: 1 | -1) {
    setIndex((current) => stepIndex(current, cards.length, step));
    setOpen(false);
    setDirection(step === 1 ? "next" : "prev");
  }

  // キーボードでも、前後の移動と答えの開閉ができる
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const action = summaryKeyAction({
        key: event.key,
        ctrlKey: event.ctrlKey,
        metaKey: event.metaKey,
        altKey: event.altKey,
        targetTag: (event.target as HTMLElement | null)?.tagName ?? "",
      });
      if (!action) return;
      event.preventDefault();
      if (action === "toggle") setOpen((current) => !current);
      else setIndex((current) => stepIndex(current, cards.length, action === "next" ? 1 : -1));
      if (action !== "toggle") {
        setOpen(false);
        setDirection(action === "next" ? "next" : "prev");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cards.length]);

  const header = (
    <div className="space-y-1">
      <Link href={`/exams/${exam.examCode}`} className="text-sm text-primary hover:underline">
        モード選択へ戻る
      </Link>
      <h1 className="h1">直前チェック(要約カード)</h1>
      <p className="text-sm text-muted">{exam.name}。問いを見て、答えを思い浮かべてから「答えを見る」を押します。</p>
    </div>
  );

  if (!card) {
    return (
      <section className="space-y-6">
        {header}
        <p className="card-dashed p-4 text-sm text-muted">この資格の要約カードは、まだありません。</p>
      </section>
    );
  }

  const isLast = index === cards.length - 1;

  return (
    <section className="space-y-6">
      {header}

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-muted" aria-live="polite">
            {index + 1} / {cards.length} 枚目
          </p>
          <QuestionChips domains={exam.domains} question={card} />
        </div>
        <div
          role="progressbar"
          aria-label="進み具合"
          aria-valuemin={0}
          aria-valuemax={cards.length}
          aria-valuenow={index + 1}
          aria-valuetext={`${index + 1} / ${cards.length} 枚目`}
          className="h-2 w-full overflow-hidden rounded-full bg-line"
        >
          <div
            className="motion-bar h-full rounded-full bg-primary"
            style={{ width: `${((index + 1) / cards.length) * 100}%` }}
          />
        </div>

        {/* カードを切り替えるたびに作り直し、切り替えの動きを付ける */}
        <article
          key={card.questionId}
          aria-label={`要約カード ${index + 1}`}
          className={`grid gap-4 lg:grid-cols-2 ${direction === "next" ? "motion-slide-next" : direction === "prev" ? "motion-slide-prev" : ""}`}
        >
          <section aria-labelledby={`${answerId}-q`} className="card space-y-3 border-l-4 border-l-primary p-5">
            <h2 id={`${answerId}-q`} className="text-sm font-bold text-primary">
              問い
            </h2>
            <p className="text-lg font-bold leading-relaxed">
              <InlineText text={card.question} />
            </p>
            {card.questionType === "multiple" ? (
              <p className="text-sm text-muted">正解は {card.answers.length} つです。</p>
            ) : null}
          </section>

          <section
            aria-labelledby={`${answerId}-a`}
            className={`card space-y-3 border-l-4 p-5 ${open ? "border-l-correct" : "border-l-line"}`}
          >
            <h2 id={`${answerId}-a`} className={`text-sm font-bold ${open ? "text-correct" : "text-muted"}`}>
              答えと決め手
            </h2>
            <button
              type="button"
              aria-expanded={open}
              aria-controls={`${answerId}-panel`}
              onClick={() => setOpen(!open)}
              className="w-full rounded-md border border-line bg-surface px-4 py-2 text-sm font-bold hover:border-primary"
            >
              {open ? "答えを隠す" : "答えを見る"}
            </button>
            <div id={`${answerId}-panel`} aria-live="polite" className="space-y-3">
              {open ? (
                <>
                  <ul className="space-y-2">
                    {card.answers.map((answer) => (
                      <li
                        key={answer.key}
                        className="flex items-start gap-3 rounded-md border border-correct bg-correct-bg p-3"
                      >
                        <ChoiceChip label={answer.key} state="correct" />
                        <div className="min-w-0 flex-1 space-y-1">
                          <p>
                            <InlineText text={answer.text} />
                          </p>
                          <p>
                            <span className="chip tone-correct">正解</span>
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                  <p className="rounded-md border-l-4 border-l-orange bg-orange-soft p-3">
                    <span className="font-bold text-orange">決め手: </span>
                    <InlineText text={card.point} />
                  </p>
                </>
              ) : (
                <p className="text-sm text-muted">答えを開くと、正解の選択肢と決め手が出ます。</p>
              )}
            </div>
          </section>
        </article>

        <div className="flex gap-3">
          <button
            type="button"
            onClick={() => go(-1)}
            className="flex-1 rounded-md border border-line bg-surface px-5 py-3 font-bold hover:border-primary"
          >
            前へ
          </button>
          <button
            type="button"
            onClick={() => go(1)}
            className="flex-1 rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
          >
            {isLast ? "最初のカードへ戻る" : "次へ"}
          </button>
        </div>
        <p className="text-sm text-muted">
          キー操作: N か → で次へ / P か ← で前へ / A か Enter で答えの開閉(最後の次は、最初へ戻ります)
        </p>
      </div>
    </section>
  );
}
