"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state.tsx";
import { ScoreRing } from "@/components/score-ring.tsx";
import { type DashboardSummary, summarize } from "@/lib/dashboard.ts";
import { fetchBookmarks, fetchReview, fetchServerResults } from "@/lib/history/client.ts";
import { mergeResults, pendingMigration } from "@/lib/history/merge.ts";
import { browserStore, loadResults, MAX_RESULTS } from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";

type Props = { exam: PublishedExam; questions: Question[] };

type State =
  | { status: "loading" }
  // source: 結果の取得元。local は、サーバーに接続できないときの、この端末の記録
  | {
      status: "ready";
      summary: DashboardSummary;
      source: "server" | "local";
      review: number | null;
      bookmarks: number | null;
    };

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

/** 資格の学習の状況(正答率、学習量、合格予測)を表示する。 */
export function DashboardView({ exam, questions }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let active = true;
    void (async () => {
      const [server, review, bookmarks] = await Promise.all([
        fetchServerResults(exam.examCode),
        fetchReview(exam.examCode),
        fetchBookmarks(exam.examCode),
      ]);
      if (!active) return;
      const local = loadResults(browserStore(), exam.examCode);
      // 結果の画面と同じく、サーバーを正とし、この端末にだけ残っている記録も合わせて数える
      const results = server === null ? local : mergeResults(server, pendingMigration(local, server));
      const known = new Set(questions.map((q) => q.questionId));
      const count = (ids: string[] | null) => (ids ? ids.filter((id) => known.has(id)).length : null);
      setState({
        status: "ready",
        summary: summarize(results, questions, exam),
        source: server === null ? "local" : "server",
        review: count(review),
        bookmarks: count(bookmarks),
      });
    })();
    return () => {
      active = false;
    };
  }, [exam, questions]);

  if (state.status === "loading") {
    return <p className="text-muted">読み込んでいます…</p>;
  }

  const { summary, source } = state;
  const header = (
    <div className="space-y-1">
      <Link href={`/exams/${exam.examCode}`} className="text-sm text-primary hover:underline">
        モード選択へ戻る
      </Link>
      <h1 className="text-2xl font-bold">学習の状況</h1>
      <p className="text-sm text-muted">{exam.name}</p>
    </div>
  );

  if (summary.attempts === 0) {
    return (
      <section className="space-y-8">
        {header}
        <EmptyState
          title="まだ結果がありません"
          description="問題を解くと、正答率や合格予測がここに表示されます。"
          action={{ label: "モード選択へ", href: `/exams/${exam.examCode}` }}
        />
      </section>
    );
  }

  const { prediction } = summary;
  const stats = [
    { label: "解いた回数", value: `${summary.attempts} 回` },
    { label: "解いた問題(延べ)", value: `${summary.answered} 問` },
    { label: "延べの正答率", value: `${summary.percent}%` },
    { label: "解いたことのある問題", value: `${summary.distinct} / ${summary.totalQuestions} 問` },
  ];

  return (
    <section className="space-y-8">
      {header}
      {source === "local" ? (
        <p role="status" className="text-sm text-muted">
          サーバーに接続できないため、この端末に保存した記録で表示しています。
        </p>
      ) : null}

      {prediction ? (
        <div className="space-y-3">
          <h2 className="text-lg font-bold">合格予測</h2>
          <div className="flex flex-col items-center gap-5 rounded-lg border border-line bg-surface p-5 sm:flex-row">
            <ScoreRing percent={prediction.averagePercent} reached={prediction.reached} />
            <div className="space-y-2">
              <p className={`font-bold ${prediction.reached ? "text-correct" : "text-warn"}`}>
                {prediction.reached
                  ? `合格ライン(${prediction.passLine}%)に届く見込みです。`
                  : `合格ライン(${prediction.passLine}%)まで、あと ${Math.round((prediction.passLine - prediction.averagePercent) * 10) / 10} ポイントです。`}
              </p>
              <p className="text-sm text-muted">
                直近 {prediction.basedOn} 回の結果の正答率の平均({prediction.averagePercent}
                %)が、合格ラインに届いているかで判定します。1 回ごとの正答率を同じ重さで平均します。 保存している結果は{" "}
                {MAX_RESULTS} 回分までです。回数が少ないうちは、ぶれが大きくなります。
              </p>
            </div>
          </div>
        </div>
      ) : null}

      <div className="space-y-3">
        <h2 className="text-lg font-bold">学習量と正答率</h2>
        <dl className="grid grid-cols-2 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border border-line bg-surface p-3">
              <dt className="text-sm text-muted">{stat.label}</dt>
              <dd className="text-xl font-bold">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-bold">直近の結果</h2>
        <ul className="space-y-1 text-sm">
          {summary.recent.map((attempt) => (
            <li key={attempt.finishedAt} className="flex justify-between rounded border border-line bg-surface p-2">
              <span>{formatDate(attempt.finishedAt)}</span>
              <span>
                {attempt.correct} / {attempt.total} 問({attempt.percent}%)
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <h2 className="text-lg font-bold">見直す問題</h2>
        <ul className="space-y-1 text-sm">
          <li>復習プール: {state.review === null ? "読み込めませんでした" : `${state.review} 問`}</li>
          <li>
            ブックマーク: {state.bookmarks === null ? "読み込めませんでした" : `${state.bookmarks} 問`}{" "}
            <Link href="/bookmarks" className="text-primary hover:underline">
              直前チェックへ
            </Link>
          </li>
        </ul>
        <p className="text-sm text-muted">復習プールやブックマークの問題は、モード選択の「出題の対象」で選べます。</p>
      </div>
    </section>
  );
}
