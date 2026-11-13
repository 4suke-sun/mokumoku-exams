"use client";

import { useId, useState } from "react";

type Props = {
  total: number;
  current: number;
  answered: readonly boolean[];
  flagged: readonly boolean[];
  onSelect: (index: number) => void;
};

/**
 * 問題一覧。番号から、好きな問題へ移れる。回答済みは塗り、見直しの印は点、今の問題は枠で示す(読み上げでは、状態を文字で添える)。
 * 幅が広い画面では、いつも開いておき、狭い画面では、ボタンで開く。
 */
export function QuestionGrid({ total, current, answered, flagged, onSelect }: Props) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const answeredCount = answered.filter(Boolean).length;
  return (
    <nav aria-label="問題一覧" className="card space-y-3 p-3">
      <div className="flex items-center justify-between gap-2">
        <h2 className="h3">問題一覧</h2>
        <span className="text-sm text-muted">
          {answeredCount} / {total} 問回答
        </span>
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
          const states = [answered[i] ? "回答済み" : "未回答", ...(flagged[i] ? ["見直し"] : [])];
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 問題の番号そのものが鍵
            <li key={i}>
              <button
                type="button"
                aria-label={`問題 ${i + 1}(${states.join("、")})`}
                aria-current={i === current ? "step" : undefined}
                onClick={() => onSelect(i)}
                className={`q-cell w-full ${answered[i] ? "q-cell-answered" : ""} ${flagged[i] ? "q-cell-flag" : ""} ${
                  i === current ? "q-cell-current" : ""
                }`}
              >
                {i + 1}
              </button>
            </li>
          );
        })}
      </ol>
      <p className="text-xs text-muted">塗り: 回答済み / 点: 見直し / 枠: 今の問題</p>
    </nav>
  );
}
