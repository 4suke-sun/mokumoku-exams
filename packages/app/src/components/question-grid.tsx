"use client";

import { useId, useState } from "react";

type Props = {
  total: number;
  /** 今の問題の位置。結果の画面のように、今の問題がないときは渡さない */
  current?: number;
  answered: readonly boolean[];
  flagged: readonly boolean[];
  /** 正誤を示すマス。true は正解、false は不正解。undefined のマスは、正誤を示さない */
  verdicts?: readonly (boolean | undefined)[];
  /** 見出しの横の要約。省くと、回答した問題の数を出す */
  summary?: string;
  onSelect: (index: number) => void;
};

/** マスの状態の言葉。読み上げのラベルに使う */
function stateOf(answered: boolean, verdict: boolean | undefined): string {
  if (verdict === true) return "正解";
  if (verdict === false) return "不正解";
  return answered ? "回答済み" : "未回答";
}

/** 凡例。正誤を示すマスがあるときは、正誤の印を先に書く */
function legendOf(verdicts: Props["verdicts"], hasCurrent: boolean): string {
  const parts = [
    ...(verdicts ? ["○: 正解", "×: 不正解"] : []),
    "塗り: 回答済み",
    "点: 見直し",
    ...(hasCurrent ? ["枠: 今の問題"] : []),
  ];
  return parts.join(" / ");
}

/**
 * 問題一覧。番号から、好きな問題へ移れる。回答済みは塗り、正誤は色と ○・×、見直しの印は点、今の問題は枠で示す
 * (読み上げでは、状態を文字で添える)。幅が広い画面では、いつも開いておき、狭い画面では、ボタンで開く。
 */
export function QuestionGrid({ total, current, answered, flagged, verdicts, summary, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const answeredCount = answered.filter(Boolean).length;
  return (
    <nav aria-label="問題一覧" className="card space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="h3">問題一覧</h2>
        <span className="text-sm text-muted">{summary ?? `${answeredCount} / ${total} 問回答`}</span>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((v) => !v)}
        className="w-full rounded-md border border-line px-3 py-1 text-sm font-bold lg:hidden"
      >
        {open ? "一覧を閉じる" : "一覧を開く"}
      </button>
      <ol id={listId} className={`${open ? "grid" : "hidden"} grid-cols-5 gap-2 lg:grid`}>
        {Array.from({ length: total }, (_, i) => {
          const verdict = verdicts?.[i];
          const states = [stateOf(answered[i] === true, verdict), ...(flagged[i] ? ["見直し"] : [])];
          const verdictClass = verdict === true ? "q-cell-correct" : verdict === false ? "q-cell-incorrect" : "";
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 問題の番号そのものが鍵
            <li key={i}>
              <button
                type="button"
                aria-label={`問題 ${i + 1}(${states.join("、")})`}
                aria-current={i === current ? "step" : undefined}
                onClick={() => onSelect(i)}
                className={`q-cell w-full ${answered[i] ? "q-cell-answered" : ""} ${verdictClass} ${
                  flagged[i] ? "q-cell-flag" : ""
                } ${i === current ? "q-cell-current" : ""}`}
              >
                {verdict === undefined ? null : (
                  <span aria-hidden="true" className="q-cell-mark">
                    {verdict ? "○" : "×"}
                  </span>
                )}
                {i + 1}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">{legendOf(verdicts, current !== undefined)}</p>
    </nav>
  );
}
