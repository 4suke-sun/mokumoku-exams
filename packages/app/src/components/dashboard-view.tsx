"use client";

import Link from "next/link";
import { useEffect, useId, useState } from "react";
import { EmptyState } from "@/components/empty-state.tsx";
import { Notice, type NoticeKind } from "@/components/notice.tsx";
import { DashboardSkeleton } from "@/components/page-skeletons.tsx";
import { PredictionPanel } from "@/components/prediction-panel.tsx";
import { StudyCalendar } from "@/components/study-calendar.tsx";
import { type DashboardSummary, type DomainStat, domainBreakdown, summarize, toScored } from "@/lib/dashboard.ts";
import { domainColorClasses } from "@/lib/domain-color.ts";
import { formatDate } from "@/lib/format.ts";
import { fetchBookmarks, fetchDays, fetchGoal, fetchReview, putGoal } from "@/lib/history/client.ts";
import { loadExamResults } from "@/lib/history/load.ts";
import { EARLIEST_GOAL_DATE, LATEST_GOAL_DATE } from "@/lib/history/schema.ts";
import { domainSelectHref, resultDetailHref } from "@/lib/quiz.ts";
import { daysBetween, jstDate, type StudyDay } from "@/lib/study-days.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { useStorageOwner } from "@/lib/use-storage-owner.ts";

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

/** 資格の学習の状況(正答率、学習量、合格予測)を表示する。 */
export function DashboardView({ exam, questions }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const owner = useStorageOwner();

  useEffect(() => {
    // 持ち主の印が取れるまでは、端末の記録を読まない(印が取れたら、読み直す)
    if (owner === undefined) return;
    let active = true;
    void (async () => {
      const [loaded, review, bookmarks, days, goal] = await Promise.all([
        loadExamResults(exam.examCode),
        fetchReview(exam.examCode),
        fetchBookmarks(exam.examCode),
        fetchDays(exam.examCode),
        fetchGoal(exam.examCode),
      ]);
      if (!active) return;
      // 結果の画面と同じく、サーバーを正とし、この端末にだけ残っている記録も合わせて数える
      const { results, source } = loaded;
      const scored = questions.map(toScored);
      const known = new Set(questions.map((q) => q.questionId));
      const count = (ids: string[] | null) => (ids ? ids.filter((id) => known.has(id)).length : null);
      setState({
        status: "ready",
        summary: summarize(results, scored, exam),
        domains: domainBreakdown(results, scored),
        source,
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
  }, [exam, questions, owner]);

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
        <Notice kind="info">サーバーに接続できないため、この端末に保存した記録で表示しています。</Notice>
      ) : null}

      {goalPanel}

      {prediction ? <PredictionPanel exam={exam} prediction={prediction} /> : null}

      <StudyCalendar days={state.days} today={state.today} scope="この資格" />

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
        <h2 className="h2">これまでの結果</h2>
        <p className="text-sm text-muted">日時を押すと、その回の結果を詳しく見られます。</p>
        <ul className="space-y-1 text-sm">
          {summary.recent.map((attempt) => (
            <li key={attempt.finishedAt} className="flex justify-between rounded border border-line bg-surface p-2">
              <Link href={resultDetailHref(exam.examCode, attempt.finishedAt)} className="text-primary hover:underline">
                {formatDate(attempt.finishedAt)}
              </Link>
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
              直前チェック(ブックマーク)へ
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
  const [message, setMessage] = useState<{ kind: NoticeKind; text: string } | null>(null);
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
        ? { kind: "success", text: next ? "目標日を保存しました。" : "目標日を消しました。" }
        : { kind: "error", text: "保存できませんでした。時間をおいて、やり直してください。" },
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
          {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
        </div>
      )}
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
