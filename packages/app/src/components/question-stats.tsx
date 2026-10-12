"use client";

import { useEffect, useState } from "react";
import { fetchStats } from "@/lib/history/client.ts";
import { type QuestionStatView, RECENT_STAT_LIMIT, recentMarks, statsFromResults } from "@/lib/question-stats.ts";
import { browserStore, loadResults } from "@/lib/storage.ts";
import type { Question } from "@/lib/types.ts";

/**
 * 問題ごとの解答回数と直近の正誤。アカウントの集計を使い、取れないとき(通信の失敗など)は、この端末の結果から数える。
 * 読み込み中は null。
 */
export function useQuestionStats(
  examCode: string,
  questions: readonly Question[],
): ReadonlyMap<string, QuestionStatView> | null {
  const [stats, setStats] = useState<ReadonlyMap<string, QuestionStatView> | null>(null);
  useEffect(() => {
    let active = true;
    void fetchStats(examCode).then((server) => {
      if (!active) return;
      setStats(server ?? statsFromResults(loadResults(browserStore(), examCode), questions));
    });
    return () => {
      active = false;
    };
  }, [examCode, questions]);
  return stats;
}

/**
 * 問題ごとの解答回数(出題の条件の「解答回数の少ない問題を優先」に使う)。アカウントの集計を使い、取れないときは、
 * この端末の結果に出てきた回数を数える。読み込み中は、空の対応。
 */
export function useAnswerCounts(examCode: string): ReadonlyMap<string, number> {
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  useEffect(() => {
    let active = true;
    void fetchStats(examCode).then((server) => {
      if (!active) return;
      if (server) {
        setCounts(new Map([...server].map(([id, stat]) => [id, stat.count])));
        return;
      }
      const local = new Map<string, number>();
      for (const result of loadResults(browserStore(), examCode)) {
        for (const id of new Set(result.questionIds)) local.set(id, (local.get(id) ?? 0) + 1);
      }
      setCounts(local);
    });
    return () => {
      active = false;
    };
  }, [examCode]);
  return counts;
}

const MARK_TEXT = { o: "○", x: "✕", "-": "-" } as const;
const MARK_LABEL = { o: "正解", x: "不正解", "-": "未受験" } as const;

/** 「直近5回 - - ○ ✕ ○」の形の正誤。古い順で、右端が最新。記号と読み上げの文言で、色だけに頼らない */
export function RecentMarks({ recent }: { recent: readonly boolean[] }) {
  const marks = recentMarks(recent);
  const label = `直近${RECENT_STAT_LIMIT}回の正誤(古い順、右が最新): ${marks.map((m) => MARK_LABEL[m]).join("、")}`;
  return (
    <p className="flex items-center gap-2 text-sm">
      <span className="text-muted" aria-hidden="true">
        直近{RECENT_STAT_LIMIT}回
      </span>
      <span role="img" aria-label={label} className="flex gap-1 font-bold tabular-nums">
        {marks.map((mark, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: 並びは古い順で固定
            key={i}
            aria-hidden="true"
            className={mark === "o" ? "text-correct" : mark === "x" ? "text-incorrect" : "text-muted"}
          >
            {MARK_TEXT[mark]}
          </span>
        ))}
      </span>
    </p>
  );
}
