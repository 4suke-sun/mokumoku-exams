"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { EmptyState } from "@/components/empty-state.tsx";
import { DashboardSkeleton } from "@/components/page-skeletons.tsx";
import { ScoreRing } from "@/components/score-ring.tsx";
import { type DashboardSummary, type DomainStat, domainBreakdown, summarize } from "@/lib/dashboard.ts";
import { domainColorClasses } from "@/lib/domain-color.ts";
import {
  fetchBookmarks,
  fetchDays,
  fetchGoal,
  fetchReview,
  fetchServerResults,
  putGoal,
} from "@/lib/history/client.ts";
import { mergeResults, pendingMigration } from "@/lib/history/merge.ts";
import { EARLIEST_GOAL_DATE, LATEST_GOAL_DATE } from "@/lib/history/schema.ts";
import { domainSelectHref } from "@/lib/quiz.ts";
import { browserStore, loadResults, MAX_RESULTS } from "@/lib/storage.ts";
import { daysBetween, heatLevel, heatmapWeeks, jstDate, type StudyDay, streakDays } from "@/lib/study-days.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";

type Props = { exam: PublishedExam; questions: Question[] };

type State =
  | { status: "loading" }
  // source: 結果の取得元。local は、サーバーに接続できないときの、この端末の記録
  | {
      status: "ready";
      summary: DashboardSummary;
      domains: DomainStat[];
      source: "server" | "local";
      review: number | null;
      bookmarks: number | null;
      // 取得できなかったときは null
      days: StudyDay[] | null;
      goal: { date: string | null } | null;
      /** 日本時間の今日 */
      today: string;
    };

/** ヒートマップの濃さごとの色(0 は学習なし) */
const HEAT_CLASSES = ["bg-line", "bg-primary/25", "bg-primary/50", "bg-primary/75", "bg-primary"];
const HEATMAP_WEEKS = 12;

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
      const [server, review, bookmarks, days, goal] = await Promise.all([
        fetchServerResults(exam.examCode),
        fetchReview(exam.examCode),
        fetchBookmarks(exam.examCode),
        fetchDays(exam.examCode),
        fetchGoal(exam.examCode),
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
        domains: domainBreakdown(results, questions),
        source: server === null ? "local" : "server",
        review: count(review),
        bookmarks: count(bookmarks),
        days,
        goal,
        today: jstDate(Date.now()),
      });
    })();
    return () => {
      active = false;
    };
  }, [exam, questions]);

  if (state.status === "loading") {
    return <DashboardSkeleton />;
  }

  const { summary, source } = state;
  const header = (
    <div className="space-y-1">
      <Link href={`/exams/${exam.examCode}`} className="text-sm text-primary hover:underline">
        モード選択へ戻る
      </Link>
      <h1 className="h1">学習の状況</h1>
      <p className="text-sm text-muted">{exam.name}</p>
    </div>
  );

  const goalPanel = <GoalPanel examCode={exam.examCode} goal={state.goal} today={state.today} />;

  if (summary.attempts === 0) {
    return (
      <section className="space-y-8">
        {header}
        {goalPanel}
        <EmptyState
          icon="📊"
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

      {goalPanel}

      {prediction ? (
        <div className="space-y-3">
          <h2 className="h2">合格予測</h2>
          <div className="card flex flex-col items-center gap-5 p-5 sm:flex-row">
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

      <StudyDays days={state.days} today={state.today} />

      <DomainList exam={exam} domains={state.domains} />

      <div className="space-y-3">
        <h2 className="h2">学習量と正答率</h2>
        <dl className="motion-stagger grid grid-cols-2 gap-3">
          {stats.map((stat) => (
            <div key={stat.label} className="card p-3">
              <dt className="text-sm text-muted">{stat.label}</dt>
              <dd className="text-xl font-bold">{stat.value}</dd>
            </div>
          ))}
        </dl>
      </div>

      <div className="space-y-2">
        <h2 className="h2">直近の結果</h2>
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
        <h2 className="h2">見直す問題</h2>
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

/** 目標日の入力と、残り日数。 */
function GoalPanel({
  examCode,
  goal,
  today,
}: {
  examCode: string;
  goal: { date: string | null } | null;
  today: string;
}) {
  const inputId = useId();
  const [saved, setSaved] = useState<string | null>(goal?.date ?? null);
  const [draft, setDraft] = useState(goal?.date ?? "");
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(next: string | null) {
    setBusy(true);
    const ok = await putGoal(examCode, next);
    setBusy(false);
    if (ok) {
      setSaved(next);
      setDraft(next ?? "");
    }
    setMessage(
      ok
        ? next
          ? "目標日を保存しました。"
          : "目標日を消しました。"
        : "保存できませんでした。時間をおいて、やり直してください。",
    );
  }

  const remaining = saved ? daysBetween(today, saved) : null;
  const countdown =
    remaining === null
      ? "目標日は、まだ決めていません。"
      : remaining > 0
        ? `目標日(${saved})まで、あと ${remaining} 日です。`
        : remaining === 0
          ? `今日が目標日(${saved})です。`
          : `目標日(${saved})を ${-remaining} 日過ぎています。`;

  return (
    <div className="space-y-3">
      <h2 className="h2">目標日</h2>
      {goal === null ? (
        <p className="text-sm text-muted">アカウントから読み込めないため、いまは目標日を表示・設定できません。</p>
      ) : (
        <div className="card space-y-3 p-4">
          <p className="font-bold">{countdown}</p>
          <div className="flex flex-wrap items-end gap-3">
            <div className="space-y-1">
              <label htmlFor={inputId} className="block text-sm text-muted">
                受験する日(目標日)
              </label>
              <input
                id={inputId}
                type="date"
                min={EARLIEST_GOAL_DATE}
                max={LATEST_GOAL_DATE}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="rounded-md border border-line bg-bg px-3 py-2"
              />
            </div>
            <button
              type="button"
              onClick={() => void save(draft)}
              disabled={busy || draft === "" || draft === saved}
              className="rounded-md bg-primary px-4 py-2 font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
            >
              保存する
            </button>
            {saved ? (
              <button
                type="button"
                onClick={() => void save(null)}
                disabled={busy}
                className="rounded-md border border-line px-4 py-2 font-bold disabled:opacity-50"
              >
                消す
              </button>
            ) : null}
          </div>
          {message ? (
            <p role="status" className="text-sm text-muted">
              {message}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/** 日ごとの学習量(連続日数と、直近 12 週のヒートマップ)。 */
function StudyDays({ days, today }: { days: StudyDay[] | null; today: string }) {
  if (days === null) {
    return (
      <div className="space-y-2">
        <h2 className="h2">日ごとの学習量</h2>
        <p className="text-sm text-muted">アカウントから読み込めないため、いまは表示できません。</p>
      </div>
    );
  }
  const weeks = heatmapWeeks(days, today, HEATMAP_WEEKS);
  const studied = weeks.flat().filter((cell) => (cell.answered ?? 0) > 0).length;
  return (
    <div className="space-y-3">
      <h2 className="h2">日ごとの学習量</h2>
      <p className="font-bold">連続 {streakDays(days, today)} 日</p>
      <div className="card space-y-2 p-4">
        <div
          role="img"
          aria-label={`直近 ${HEATMAP_WEEKS} 週のうち、学習した日は ${studied} 日です。`}
          className="flex gap-1"
        >
          {weeks.map((week) => (
            <div key={week[0]?.date} className="flex flex-col gap-1">
              {week.map((cell) =>
                cell.answered === null ? (
                  <span key={cell.date} className="size-4" />
                ) : (
                  <span
                    key={cell.date}
                    title={`${cell.date}: ${cell.answered} 問`}
                    className={`size-4 rounded-sm ${HEAT_CLASSES[heatLevel(cell.answered)]}`}
                  />
                ),
              )}
            </div>
          ))}
        </div>
        <p className="text-sm text-muted">
          直近 {HEATMAP_WEEKS} 週(列が週で、上が日曜)。色が濃いほど、その日に多く解いています。
          アカウントに保存した結果を、完了した日(日本時間)で数えます。
        </p>
      </div>
    </div>
  );
}

/** 分野別の正答率(低い順)と、その分野だけを選んだモード選択への導線。 */
function DomainList({ exam, domains }: { exam: PublishedExam; domains: DomainStat[] }) {
  const names = new Map(exam.domains.map((d) => [d.code, d.name]));
  const listed = domains.filter((d) => names.has(d.domain));
  if (listed.length === 0) return null;
  return (
    <div className="space-y-2">
      <h2 className="h2">分野別の正答率</h2>
      <p className="text-sm text-muted">直近の結果から、正答率の低い分野を先に並べます。</p>
      <ul className="space-y-1 text-sm">
        {listed.map((stat) => {
          const color = domainColorClasses(exam.domains, stat.domain);
          return (
            <li
              key={stat.domain}
              className={`flex flex-wrap items-center justify-between gap-2 rounded border border-l-4 border-line bg-surface p-2 ${color?.border ?? ""}`}
            >
              <span className={`font-bold ${color?.text ?? ""}`}>{names.get(stat.domain)}</span>
              <span className="flex items-center gap-3">
                <span>
                  {stat.correct} / {stat.answered} 問({stat.percent}%)
                </span>
                <Link href={domainSelectHref(exam.examCode, stat.domain)} className="text-primary hover:underline">
                  この分野を解く
                </Link>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
