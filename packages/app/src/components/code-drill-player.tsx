"use client";

import type { CodeDrillOutcome, CodeDrillProblem } from "@mokumoku-exams/data-schema/code-drill-data/schema";
import Link from "next/link";
import { useEffect, useId, useRef, useState } from "react";
import { DiagramView } from "@/components/diagram.tsx";
import { ReferenceList } from "@/components/reference-list.tsx";
import { InlineText, RichText } from "@/components/rich-text.tsx";
import {
  blankIsCorrect,
  clearFill,
  emptyFill,
  type FillState,
  type Fragment,
  fillComplete,
  fragmentsOf,
  gradeFill,
  hintFill,
  judgeCode,
  placeFragment,
  removeFragment,
  templateParts,
  textHint,
  textHintSteps,
} from "@/lib/code-drill.ts";

type Mode = "fill" | "text";

export const LANGUAGE_LABELS: Record<CodeDrillProblem["language"], string> = { sql: "SQL", pyspark: "PySpark" };
const OUTCOME_LABELS: Record<CodeDrillOutcome["kind"], string> = {
  error: "エラーになります",
  "different-result": "結果が変わります",
  "same-result": "結果は同じでも、要件を満たしません",
};

/** 「実行するとどうなるか」: 種類の見出しと文章と、あれば図 */
function OutcomeView({ outcome, id, heading }: { outcome: CodeDrillOutcome; id: string; heading?: string }) {
  return (
    <div className="space-y-2 rounded-md border-l-4 border-warn bg-warn-bg px-4 py-3">
      <p className="font-bold text-warn">{heading ?? `実行すると: ${OUTCOME_LABELS[outcome.kind]}`}</p>
      <p className="notebook-prose">
        <InlineText text={outcome.text} />
      </p>
      {outcome.diagram ? (
        <div className="card p-3">
          <DiagramView diagram={outcome.diagram} id={id} stackOnNarrow />
        </div>
      ) : null}
    </div>
  );
}

/** コード。文字としてだけ表示する(HTML として解釈しない)。長い行は、欄の中で横にスクロールする */
function CodeBlock({ code, label }: { code: string; label: string }) {
  return (
    <figure aria-label={label}>
      <pre className="overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-sm">
        <code>{code}</code>
      </pre>
    </figure>
  );
}

/**
 * コードドリルの 1 問。穴埋め(断片を押すと先頭の空いた穴に入る)と全文入力を切り替えて解く。
 * どちらも「回答する」を押すまで回答にしない。ヒントは、押すたびに 1 か所ずつ正解を明かす(回数の上限なし)。
 * コードは実行しない。結果は保存しない。
 */
export function CodeDrillPlayer({
  problem,
  domainName,
  basePath,
  nextHref,
}: {
  problem: CodeDrillProblem;
  domainName: string;
  basePath: string;
  nextHref: string | null;
}) {
  const [mode, setMode] = useState<Mode>("fill");
  // 断片の並びは、描いたあとに入れ替える(サーバーの描画と食い違わないように)
  const [fragments, setFragments] = useState<Fragment[]>(() => fragmentsOf(problem, () => 0.999));
  const [fill, setFill] = useState<FillState>(() => emptyFill(problem));
  const [text, setText] = useState("");
  const [textLevel, setTextLevel] = useState(0);
  const [hints, setHints] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [announce, setAnnounce] = useState("");
  const verdictRef = useRef<HTMLDivElement>(null);
  const textId = useId();

  useEffect(() => {
    setFragments(fragmentsOf(problem, Math.random));
  }, [problem]);

  useEffect(() => {
    if (revealed) verdictRef.current?.focus();
  }, [revealed]);

  const textOf = (id: string | null) => fragments.find((f) => f.id === id)?.text ?? "";
  const fillGrade = gradeFill(problem, fragments, fill);
  const textJudge = judgeCode(problem, text);
  const correct = mode === "fill" ? fillGrade.correct : textJudge.correct;
  const fillHintLeft = problem.blanks.some((_, i) => !blankIsCorrect(problem, fragments, fill, i));
  const hintLeft = mode === "fill" ? fillHintLeft : textLevel < textHintSteps(problem);
  const canSubmit = mode === "fill" ? fillComplete(fill) : text.trim() !== "";

  function place(fragment: Fragment) {
    const next = placeFragment(fill, fragment.id);
    const at = next.placed.indexOf(fragment.id);
    if (at >= 0 && next !== fill) setAnnounce(`穴 ${at + 1} に ${fragment.text} を入れました`);
    setFill(next);
  }

  function hint() {
    setHints((n) => n + 1);
    if (mode === "fill") {
      const next = hintFill(problem, fragments, fill);
      const at = next.hinted.findIndex((h, i) => h && !fill.hinted[i]);
      if (at >= 0) setAnnounce(`穴 ${at + 1} に ${textOf(next.placed[at] ?? null)} を入れました(ヒント)`);
      setFill(next);
    } else {
      setTextLevel((level) => level + 1);
      setAnnounce(
        textLevel === 0
          ? "穴のあるコードをヒントの欄に出しました(ヒント)"
          : `穴 ${textLevel} は ${problem.blanks[textLevel - 1]?.answer ?? ""} です(ヒント)`,
      );
    }
  }

  function retry() {
    setFill(emptyFill(problem));
    setText("");
    setTextLevel(0);
    setHints(0);
    setRevealed(false);
    setAnnounce("");
    setFragments(fragmentsOf(problem, Math.random));
  }

  const hintText = textHint(problem, textLevel);
  const mistake = textJudge.mistake === null ? null : (problem.mistakes?.[textJudge.mistake] ?? null);

  return (
    <article className="space-y-6">
      <div className="space-y-2">
        <nav aria-label="パンくずリスト" className="text-sm text-muted">
          <Link href={basePath} className="text-primary hover:underline">
            コードドリル
          </Link>
          <span aria-hidden="true"> › </span>
          {domainName}
        </nav>
        <h1 className="h1">{problem.title}</h1>
        <p>
          <span className="chip tone-primary">{LANGUAGE_LABELS[problem.language]}</span>
        </p>
        <RichText text={problem.prompt} className="notebook-prose" />
      </div>

      <div role="tablist" aria-label="解き方" className="flex gap-2">
        {(["fill", "text"] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            disabled={revealed && mode !== m}
            onClick={() => setMode(m)}
            className={`rounded-md border px-4 py-2 text-sm font-bold disabled:opacity-50 ${
              mode === m ? "border-primary bg-soft text-primary" : "border-line bg-surface"
            }`}
          >
            {m === "fill" ? "穴埋め" : "全文入力"}
          </button>
        ))}
      </div>

      <p aria-live="polite" className="sr-only">
        {announce}
      </p>

      {mode === "fill" ? (
        <section aria-label="穴埋め" className="space-y-4">
          <pre className="overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-sm leading-8">
            <code>
              {templateParts(problem.template).map((part, i) =>
                part.kind === "code" ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 穴のあるコードの並びは固定
                  <span key={i}>{part.text}</span>
                ) : (
                  <button
                    // biome-ignore lint/suspicious/noArrayIndexKey: 穴のあるコードの並びは固定
                    key={i}
                    type="button"
                    disabled={revealed || fill.hinted[part.index] || fill.placed[part.index] === null}
                    onClick={() => {
                      setAnnounce(`穴 ${part.index + 1} から ${textOf(fill.placed[part.index] ?? null)} を外しました`);
                      setFill(removeFragment(fill, part.index));
                    }}
                    aria-label={`穴 ${part.index + 1}: ${
                      fill.placed[part.index] === null ? "空" : textOf(fill.placed[part.index] ?? null)
                    }${fill.hinted[part.index] ? "(ヒント)" : ""}${
                      revealed ? (blankIsCorrect(problem, fragments, fill, part.index) ? "。正解" : "。不正解") : ""
                    }`}
                    className={`mx-0.5 inline-block min-w-16 rounded border-2 border-dashed px-1 align-middle ${
                      revealed
                        ? blankIsCorrect(problem, fragments, fill, part.index)
                          ? "border-correct bg-correct-bg"
                          : "border-incorrect bg-incorrect-bg"
                        : fill.placed[part.index] === null
                          ? "border-line text-muted"
                          : "motion-select border-primary bg-soft"
                    }`}
                  >
                    {fill.placed[part.index] === null ? (
                      `［穴 ${part.index + 1}］`
                    ) : (
                      <>
                        {textOf(fill.placed[part.index] ?? null)}
                        {fill.hinted[part.index] ? <span className="ml-1 text-xs text-muted">ヒント</span> : null}
                        {revealed ? (blankIsCorrect(problem, fragments, fill, part.index) ? " ○" : " ×") : null}
                      </>
                    )}
                  </button>
                ),
              )}
            </code>
          </pre>
          {revealed ? null : (
            <>
              <p className="text-sm text-muted">断片を押すと、先頭の空いた穴に入ります。入れた穴を押すと、外れます。</p>
              <ul aria-label="断片" className="flex flex-wrap gap-2">
                {fragments.map((fragment) => {
                  const used = fill.placed.includes(fragment.id);
                  return (
                    <li key={fragment.id}>
                      <button
                        type="button"
                        disabled={used || fillComplete(fill)}
                        onClick={() => place(fragment)}
                        className="rounded-md border border-line bg-surface px-3 py-1 font-mono text-sm disabled:opacity-40"
                      >
                        {fragment.text}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                onClick={() => {
                  setFill(clearFill(fill));
                  setAnnounce("ヒントで埋めた穴を除いて、すべての穴を空にしました");
                }}
                className="rounded-md border border-line px-3 py-1 text-sm font-bold"
              >
                すべてクリア
              </button>
            </>
          )}
        </section>
      ) : (
        <section aria-label="全文入力" className="space-y-3">
          <label htmlFor={textId} className="block font-bold">
            コード全体を入力してください
          </label>
          <textarea
            id={textId}
            value={text}
            readOnly={revealed}
            onChange={(event) => setText(event.target.value)}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            rows={Math.max(6, problem.solutions[0]?.split("\n").length ?? 6)}
            className="w-full rounded-md border border-line bg-surface p-3 font-mono text-sm"
          />
          {hintText ? (
            <div className="space-y-1">
              <p className="text-sm font-bold text-muted">ヒント</p>
              <CodeBlock code={hintText} label="ヒントのコード" />
            </div>
          ) : null}
        </section>
      )}

      {revealed ? null : (
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={!canSubmit}
            onClick={() => setRevealed(true)}
            className="rounded-md bg-primary px-5 py-2 font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
          >
            回答する
          </button>
          <button
            type="button"
            disabled={!hintLeft}
            onClick={hint}
            className="rounded-md border border-line px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            ヒント
          </button>
          {hints > 0 ? <span className="text-sm text-muted">ヒント {hints} 回</span> : null}
        </div>
      )}

      {revealed ? (
        <section aria-label="結果" className="space-y-4">
          <div
            ref={verdictRef}
            tabIndex={-1}
            role="status"
            className={`rounded-md border-l-4 p-3 font-bold ${
              correct
                ? "motion-correct border-correct bg-correct-bg text-correct"
                : "border-incorrect bg-incorrect-bg text-incorrect"
            }`}
          >
            {correct ? "○ 正解です" : "× 不正解です"}
            {hints > 0 ? <span className="ml-2 text-sm text-fg">(ヒントを {hints} 回使いました)</span> : null}
          </div>

          {!correct && mode === "fill"
            ? fillGrade.blanks.map((blank, i) =>
                blank.correct ? null : blank.outcome ? (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 穴の番号が識別子
                  <div key={i} className="space-y-1">
                    <p className="text-sm font-bold">
                      穴 {i + 1} に入れた断片: <code>{blank.text}</code>
                    </p>
                    <OutcomeView outcome={blank.outcome} id={`${problem.id}-blank-${i + 1}`} />
                  </div>
                ) : (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 穴の番号が識別子
                  <p key={i} className="rounded-md border-l-4 border-warn bg-warn-bg px-4 py-3">
                    穴 {i + 1} に入れた <code>{blank.text}</code> は、この位置には入りません。穴 {i + 1} の正解は{" "}
                    <code>{problem.blanks[i]?.answer}</code> です。
                  </p>
                ),
              )
            : null}

          {!correct && mode === "text" ? (
            mistake ? (
              <OutcomeView outcome={mistake.outcome} id={`${problem.id}-mistake`} heading="よくある誤りです" />
            ) : (
              <p className="rounded-md border-l-4 border-warn bg-warn-bg px-4 py-3">
                入力したコードは、正解・別解のどれとも一致しませんでした。コードは実行しないので、入力したコードの結果は示せません。下の正解のコードと比べてください。
              </p>
            )
          ) : null}

          <div className="space-y-1">
            <h2 className="h3">正解のコード</h2>
            <CodeBlock code={problem.solutions[0] ?? ""} label="正解のコード" />
            {problem.solutions.length > 1 ? (
              <details className="card p-3">
                <summary className="cursor-pointer text-sm font-bold">別解({problem.solutions.length - 1})</summary>
                <div className="mt-2 space-y-2">
                  {problem.solutions.slice(1).map((solution) => (
                    <CodeBlock key={solution} code={solution} label="別解" />
                  ))}
                </div>
              </details>
            ) : null}
          </div>

          <div className="space-y-2">
            <h2 className="h3">正解のコードを実行すると</h2>
            <p className="notebook-prose">
              <InlineText text={problem.result.text} />
            </p>
            {problem.result.diagram ? (
              <div className="card p-3">
                <DiagramView diagram={problem.result.diagram} id={`${problem.id}-result`} stackOnNarrow />
              </div>
            ) : null}
          </div>

          <div className="space-y-2">
            <h2 className="h3">解説</h2>
            <RichText text={problem.explanation} className="notebook-prose" />
          </div>
          <ReferenceList references={problem.references} />

          <div className="flex flex-wrap gap-3">
            <button type="button" onClick={retry} className="rounded-md border border-line px-4 py-2 font-bold">
              もう一度
            </button>
            {nextHref ? (
              <Link
                href={nextHref}
                className="rounded-md bg-primary px-4 py-2 font-bold text-on-primary hover:opacity-90"
              >
                次の問題
              </Link>
            ) : (
              <Link
                href={basePath}
                className="rounded-md bg-primary px-4 py-2 font-bold text-on-primary hover:opacity-90"
              >
                一覧へ戻る
              </Link>
            )}
          </div>
        </section>
      ) : null}
    </article>
  );
}
