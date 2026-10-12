"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state.tsx";
import { ListSkeleton } from "@/components/page-skeletons.tsx";
import { PredictionCard } from "@/components/prediction-card.tsx";
import { StudyCalendar } from "@/components/study-calendar.tsx";
import { formatDate } from "@/lib/format.ts";
import { type ExamEntry, type ExamSummary, loadAllDays, loadSummaries } from "@/lib/history/summaries.ts";
import { resultDetailHref } from "@/lib/quiz.ts";
import { jstDate, type StudyDay } from "@/lib/study-days.ts";

type State =
  | { status: "loading" }
  // days: 取得できなかったときは null
  | { status: "ready"; summaries: ExamSummary[]; days: StudyDay[] | null; today: string };

/** 全資格の学習の実績(連続学習、カレンダー、資格ごとの受験の概要と合格予測)。 */
export function AchievementsView({ entries }: { entries: ExamEntry[] }) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void (async () => {
      const [summaries, days] = await Promise.all([loadSummaries(entries), loadAllDays(entries)]);
      if (!active) return;
      setState({ status: "ready", summaries, days, today: jstDate(Date.now()) });
    })();
    return () => {
      active = false;
    };
  }, [entries]);

  const header = (
    <div className="space-y-1">
      <h1 className="h1">実績</h1>
      <p className="text-sm text-muted">すべての資格の学習の記録です。</p>
    </div>
  );

  if (state.status === "loading") {
    return (
      <section className="space-y-8">
        {header}
        <ListSkeleton rows={3} />
      </section>
    );
  }

  const { summaries, days, today } = state;
  const attempted = summaries.filter(({ summary }) => summary.attempts > 0);
  const offline = summaries.some(({ source }) => source === "local");

  return (
    <section className="space-y-8">
      {header}
      {offline ? (
        <p role="status" className="text-sm text-muted">
          サーバーに接続できないため、この端末に保存した記録で表示しています。
        </p>
      ) : null}

      <StudyCalendar days={days} today={today} scope="すべての資格の" />

      <div className="space-y-3">
        <h2 className="h2">資格ごとの受験</h2>
        {attempted.length === 0 ? (
          <EmptyState
            icon="📊"
            title="まだ結果がありません"
            description="問題を解くと、資格ごとの受験回数や最高点、合格予測がここに表示されます。"
            action={{ label: "資格を選ぶ", href: "/exams" }}
          />
        ) : (
          <ul className="motion-stagger grid gap-4 lg:grid-cols-2">
            {attempted.map(({ entry, summary }) => {
              const best = Math.max(...summary.recent.map((r) => r.percent));
              const latest = summary.recent[0];
              return (
                <li key={entry.exam.examCode} className="space-y-3">
                  <div className="card space-y-3 p-4">
                    <h3 className="h3">{entry.exam.name}</h3>
                    <dl className="grid grid-cols-3 gap-2 text-sm">
                      <div>
                        <dt className="text-muted">受験回数</dt>
                        <dd className="text-lg font-bold">{summary.attempts} 回</dd>
                      </div>
                      <div>
                        <dt className="text-muted">最高点</dt>
                        <dd className="text-lg font-bold">{best}%</dd>
                      </div>
                      <div>
                        <dt className="text-muted">直近の点</dt>
                        <dd className="text-lg font-bold">{latest?.percent ?? 0}%</dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                      {latest ? (
                        <Link
                          href={resultDetailHref(entry.exam.examCode, latest.finishedAt)}
                          className="text-primary hover:underline"
                        >
                          直近の受験({formatDate(latest.finishedAt)})を見る
                        </Link>
                      ) : null}
                      <Link href={`/exams/${entry.exam.examCode}/dashboard`} className="text-primary hover:underline">
                        学習の状況・目標日
                      </Link>
                    </div>
                  </div>
                  {summary.prediction ? <PredictionCard exam={entry.exam} prediction={summary.prediction} /> : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
