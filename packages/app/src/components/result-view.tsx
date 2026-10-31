"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BookmarkError, BookmarkToggle, useBookmarks } from "@/components/bookmark-toggle.tsx";
import { ChoiceReview } from "@/components/choice-review.tsx";
import { Confetti } from "@/components/confetti.tsx";
import { type BarRow, DomainBars } from "@/components/domain-bars.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { ExplanationView } from "@/components/explanation-view.tsx";
import { MoreResults } from "@/components/more-results.tsx";
import { Notice } from "@/components/notice.tsx";
import { ResultSkeleton } from "@/components/page-skeletons.tsx";
import { QuestionChips } from "@/components/question-chips.tsx";
import { ReferenceList } from "@/components/reference-list.tsx";
import { RichText } from "@/components/rich-text.tsx";
import { FreeTextScore } from "@/components/rubric-view.tsx";
import { ScoreRing } from "@/components/score-ring.tsx";
import type { QuestionOutline } from "@/lib/dashboard.ts";
import { attemptDomains, averageTimeMs } from "@/lib/dashboard.ts";
import { domainColorClasses } from "@/lib/domain-color.ts";
import { formatAnswerTime, formatDate } from "@/lib/format.ts";
import { fetchServerResult, fetchServerResultsPage, postServerResult } from "@/lib/history/client.ts";
import { appendResults, mergeResults, pendingMigration } from "@/lib/history/merge.ts";
import { fetchQuestions } from "@/lib/questions/client.ts";
import {
  answerFor,
  displayLabels,
  isQuestionCorrect,
  labelKeys,
  orderChoices,
  passLinePercent,
  requestedResultAt,
  resultDetailHref,
  score,
  textAnswerFor,
} from "@/lib/quiz.ts";
import { recentOutcomes } from "@/lib/recent-outcomes.ts";
import { sectionPassLine, sectionStatus, sectionsOf, sectionTargets } from "@/lib/sections.ts";
import { SESSION_SAVE_FAILED, startSession } from "@/lib/start-session.ts";
import {
  browserStore,
  clearResults,
  loadResults,
  loadSectionProgress,
  loadStageProgress,
  type Result,
  type SectionProgress,
  type SectionRecord,
  type StageCheck,
} from "@/lib/storage.ts";
import { STAGE_PASS_PERCENT } from "@/lib/study-stages.ts";
import type { ChoiceQuestion, FreeTextQuestion, PublishedExam, Question } from "@/lib/types.ts";
import { useStorageOwner } from "@/lib/use-storage-owner.ts";

/**
 * `outline` は、資格の全問の要約(採点・分野・選択肢の記号)。詳しく出す回の問題(本文・解説)は、開いたあとに、
 * その回の分だけを取る(資格の全問を、画面の応答に入れない)。
 */
type Props = { exam: PublishedExam; outline: QuestionOutline[] };

type State =
  | { status: "loading" }
  // source: 結果の取得元。server はアカウントに保存した記録、local は(サーバーに接続できないときの)この端末の記録。
  // pending: この端末にだけ残っていて、まだアカウントに移していない記録
  // target: `?at=` で 1 回分を開いたときの、その結果(見つからなければ "not-found")
  | {
      status: "ready";
      results: Result[];
      source: "server" | "local";
      pending: Result[];
      target?: Result | "not-found";
      /** サーバーの一覧の続きを取る位置(続きがなければ null) */
      next: string | null;
    };

function keysLabel(keys: readonly string[]): string {
  return keys.length === 0 ? "未回答" : keys.join("、");
}

/** 問題ごとの直近の正誤(新しい順)。 */
function RecentOutcomeMarks({ outcomes }: { outcomes: readonly boolean[] }) {
  if (outcomes.length === 0) return null;
  const label = `直近 ${outcomes.length} 回の正誤(新しい順)`;
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="text-muted">{label}</span>
      <ol aria-label={label} className="flex gap-1">
        {outcomes.map((ok, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 並びは新しい順で固定
          <li key={i} className={`font-bold ${ok ? "text-correct" : "text-incorrect"}`}>
            <span aria-hidden="true">{ok ? "○" : "×"}</span>
            <span className="sr-only">{ok ? "正解" : "不正解"}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** セクションの合否の文字の色。解き直しは、すべて正解したときだけ正解の色 */
function sectionTone(section: SectionRecord): string {
  if (section.retry) return section.correct >= section.total ? "text-correct" : "text-warn";
  return sectionStatus(section) === "failed" ? "text-warn" : "text-correct";
}
export function ResultView({ exam, outline }: Props) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [retryError, setRetryError] = useState<string | null>(null);
  const [wrongOnly, setWrongOnly] = useState(false);
  const [migration, setMigration] = useState<"idle" | "busy" | "failed">("idle");
  const [stageCheck, setStageCheck] = useState<StageCheck | null>(null);
  const [sectionCheck, setSectionCheck] = useState<SectionProgress["last"] | null>(null);
  const bookmarks = useBookmarks(exam.examCode);
  const owner = useStorageOwner();

  useEffect(() => {
    // 持ち主の印が取れるまでは、端末の記録を読まない(印が取れたら、読み直す)
    if (owner === undefined) return;
    let active = true;
    void (async () => {
      const local = loadResults(browserStore(), exam.examCode);
      setStageCheck(loadStageProgress(browserStore(), exam.examCode).last ?? null);
      setSectionCheck(loadSectionProgress(browserStore(), exam.examCode).last ?? null);
      const at = requestedResultAt(window.location.search);
      const page = await fetchServerResultsPage(exam.examCode);
      if (!active) return;
      const server = page?.results ?? null;
      const pending = server === null ? [] : pendingMigration(local, server);
      const results = server === null ? local : mergeResults(server, pending);
      // 1 回分を開くとき: 一覧になければ(古い結果)、アカウントから 1 件だけ取る
      let target: Result | "not-found" | undefined;
      if (at !== null) {
        target = results.find((r) => r.finishedAt === at);
        if (!target && server !== null) {
          const fetched = await fetchServerResult(exam.examCode, at);
          if (!active) return;
          target = fetched ?? undefined;
        }
        target ??= "not-found";
      }
      setState({
        status: "ready",
        results,
        source: server === null ? "local" : "server",
        pending,
        target,
        next: page?.next ?? null,
      });
    })();
    return () => {
      active = false;
    };
  }, [exam.examCode, owner]);

  // 詳しく出す回(`?at=` の回、なければ最新)の問題だけを取る
  const shown =
    state.status === "ready" && state.target !== "not-found" ? (state.target ?? state.results[0]) : undefined;
  const [details, setDetails] = useState<{ at: string; questions: Map<string, Question> | null } | null>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: 詳しく出す回が変わったときだけ取り直す
  useEffect(() => {
    if (!shown) return;
    let active = true;
    void fetchQuestions(exam.examCode, shown.questionIds).then((found) => {
      if (!active) return;
      setDetails({ at: shown.finishedAt, questions: found ? new Map(found.map((q) => [q.questionId, q])) : null });
    });
    return () => {
      active = false;
    };
  }, [exam.examCode, shown?.finishedAt]);

  /** この端末にだけある記録を、アカウントに移す。すべて移せたときだけ、端末の記録を消す。 */
  async function migrate() {
    if (state.status !== "ready" || migration === "busy") return;
    setMigration("busy");
    for (const result of state.pending) {
      if (!(await postServerResult(result))) {
        setMigration("failed");
        return;
      }
    }
    clearResults(browserStore(), exam.examCode);
    setState({ ...state, pending: [] });
    setMigration("idle");
  }

  if (state.status === "loading") {
    return <ResultSkeleton />;
  }

  if (state.target === "not-found") {
    return (
      <EmptyState
        icon="🔍"
        headingLevel={1}
        title="その回の結果は見つかりません"
        description="結果が消えたか、アドレスが違う可能性があります。最新の結果か、学習の状況の一覧から開き直してください。"
        action={{ label: "最新の結果へ", href: `/exams/${exam.examCode}/result` }}
      />
    );
  }

  // 1 回分を開いたときは、その結果を出し、ほかを「これまでの結果」に並べる
  const latest = state.target ?? state.results[0];
  const isNewest = latest !== undefined && latest.finishedAt === state.results[0]?.finishedAt;
  const previous = state.results.filter((r) => r.finishedAt !== latest?.finishedAt);
  if (latest && details?.at !== latest.finishedAt) return <ResultSkeleton />;
  if (latest && details?.questions === null) {
    return <Notice kind="error">問題を読み込めませんでした。時間をおいて、開き直してください。</Notice>;
  }
  const byId = new Map(outline.map((q) => [q.questionId, q]));
  const answered = latest
    ? latest.questionIds.map((id) => details?.questions?.get(id)).filter((q): q is Question => q !== undefined)
    : [];

  if (!latest || answered.length === 0) {
    return (
      <EmptyState
        icon="📝"
        headingLevel={1}
        title="結果がありません"
        description="問題を解くと、ここに結果が表示されます。"
        action={{ label: "モード選択へ", href: `/exams/${exam.examCode}` }}
      />
    );
  }

  const result = score(answered, latest.answers, latest.textAnswers);
  // 結果の問題の並びの位置(回答時間・印は、この位置の配列)
  const positions = new Map(latest.questionIds.map((id, i) => [id, i]));
  const allRows = answered.map((question, i) => {
    const at = positions.get(question.questionId) ?? -1;
    return {
      question,
      number: i + 1,
      correct: isQuestionCorrect(question, latest.answers, latest.textAnswers),
      unsure: latest.unsure?.[at] === true,
      flagged: latest.flagged?.[at] === true,
      timeMs: latest.timesMs?.[at],
    };
  });
  // 解き直しの対象: 間違えた問題と、自信なしの印を付けた問題(出題した順)
  const retryRows = allRows.filter((row) => !row.correct || row.unsure);

  /**
   * 間違えた問題(と自信なし)だけで、新しい出題を始める。結果は、通常の結果として保存される。
   * セクション(とその解き直し)の結果からのときは、そのセクションの解き直しの印を付ける(すべて正解すると、未達のセクションが合格になる)
   */
  function retry() {
    const items = retryRows.map(({ question }) => ({
      questionId: question.questionId,
      choiceKeys: question.questionType === "free-text" ? [] : question.choices.map((c) => c.key),
    }));
    const href = startSession(browserStore(), exam.examCode, items, section ? { retryOf: section.section } : {});
    if (!href) {
      setRetryError(SESSION_SAVE_FAILED);
      return;
    }
    router.push(href);
  }
  const wrongCount = allRows.filter((row) => !row.correct).length;
  // 保存した結果(最大 10 回)から、問題ごとの直近の正誤を出す(新しく保存はしない)
  const outcomes = recentOutcomes(state.results, outline);
  // 見直すときも、元の問題番号を保つ(「問題 3」は、結果の中の 3 問目のまま)
  const rows = wrongOnly ? allRows.filter((row) => !row.correct) : allRows;
  const passLine = passLinePercent(exam);
  const reached = result.percent >= passLine;
  // 回答時間のない古い結果では、平均を出さない
  const average = averageTimeMs(latest);
  const names = new Map(exam.domains.map((d) => [d.code, d.name]));
  const domainRows: BarRow[] = attemptDomains(latest, outline, exam.domains).map((row) => {
    const color = domainColorClasses(exam.domains, row.domain);
    const time = row.avgTimeMs === null ? "" : `、平均 ${formatAnswerTime(row.avgTimeMs)}/問`;
    return {
      key: row.domain,
      label: names.get(row.domain) ?? row.domain,
      percent: row.percent,
      detail: `${row.correct} / ${row.answered} 問(${row.percent}%${time})`,
      textClass: color?.text,
      barClass: color?.bar ?? "bg-primary",
    };
  });
  const perfect = result.total > 0 && result.correct === result.total;
  // 直近の結果が段階の確認問題のときだけ、段階の合否を伝える
  const stage = stageCheck && stageCheck.finishedAt === latest.finishedAt ? stageCheck : null;
  // 直近の結果がセクションの出題のときだけ、セクションの合否と、次のセクションを出す
  const section = sectionCheck && sectionCheck.finishedAt === latest.finishedAt ? sectionCheck : null;
  const sections = sectionsOf(sectionTargets(outline).map((q) => q.questionId));
  const nextSection = section && section.section + 1 < sections.length ? section.section + 1 : null;

  /** 次のセクションの出題を始める */
  function startSection(index: number) {
    const ids = sections[index] ?? [];
    const items = ids.flatMap((id) => {
      const question = byId.get(id);
      return question ? [{ questionId: id, choiceKeys: question.choiceKeys }] : [];
    });
    const href = startSession(browserStore(), exam.examCode, items, { section: index });
    if (!href) {
      setRetryError(SESSION_SAVE_FAILED);
      return;
    }
    router.push(href);
  }

  return (
    <section className="space-y-8">
      {state.source === "local" ? (
        <Notice kind="info">サーバーに接続できないため、この端末に保存した記録を表示しています。</Notice>
      ) : null}
      {state.pending.length > 0 ? (
        <div role="status" className="card space-y-2 p-4">
          {state.pending.some((r) => r.finishedAt === state.results[0]?.finishedAt) ? (
            <p className="font-bold text-warn">
              直近の結果は、アカウントに保存できませんでした。この端末にだけ残っています。
            </p>
          ) : null}
          <p>
            この端末にだけ残っている記録が {state.pending.length}{" "}
            件あります。アカウントに移すと、ほかの端末からも見られます。
          </p>
          <button
            type="button"
            onClick={() => void migrate()}
            disabled={migration === "busy"}
            className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-bold disabled:opacity-50"
          >
            {migration === "busy" ? "移しています…" : "アカウントに移す"}
          </button>
          {migration === "failed" ? (
            <Notice kind="error">移せなかった記録があります。時間をおいて、もう一度お試しください。</Notice>
          ) : null}
        </div>
      ) : null}
      {stage ? (
        <div role="status" className="card space-y-2 p-4">
          <p className={`font-bold ${stage.passed ? "text-correct" : "text-warn"}`}>
            {stage.passed
              ? `段階の確認問題に合格しました(正答率 ${stage.percent}%)。単元の画面で、次の段階を確かめられます。`
              : `段階の確認問題は、正答率 ${STAGE_PASS_PERCENT}% 以上で合格です(今回は ${stage.percent}%)。単元を読み直して、もう一度挑戦しましょう。`}
          </p>
          <Link
            href={`/exams/${exam.examCode}/study/${stage.unitId}`}
            className="inline-block text-sm text-primary hover:underline"
          >
            単元へ戻る
          </Link>
        </div>
      ) : null}
      {section ? (
        <div role="status" className="card space-y-3 p-4">
          <p className={`font-bold ${sectionTone(section)}`}>
            {section.retry
              ? section.correct >= section.total
                ? `解き直しの ${section.total} 問をすべて正解しました。セクション ${section.section + 1} は合格です(満点は、セクションを通して全問正解したときに付きます)。`
                : `解き直しは ${section.correct} / ${section.total} 問の正解でした。間違えた問題をすべて正解すると、未達のセクションは合格になります。`
              : sectionStatus(section) === "perfect"
                ? `セクション ${section.section + 1} を満点で合格しました(${section.correct} / ${section.total} 問)。`
                : sectionStatus(section) === "passed"
                  ? `セクション ${section.section + 1} に合格しました(${section.correct} / ${section.total} 問)。`
                  : `セクション ${section.section + 1} は、${sectionPassLine(section.total)} 問以上の正解で合格です(今回は ${section.correct} / ${section.total} 問)。`}
          </p>
          <div className="flex flex-wrap gap-3">
            {nextSection !== null ? (
              <button
                type="button"
                onClick={() => startSection(nextSection)}
                className="rounded-md bg-primary px-4 py-2 font-bold text-on-primary hover:opacity-90"
              >
                次のセクションへ(セクション {nextSection + 1})
              </button>
            ) : null}
            <Link
              href={`/exams/${exam.examCode}/sections`}
              className="rounded-md border border-line bg-surface px-4 py-2 font-bold"
            >
              セクションの一覧へ
            </Link>
          </div>
        </div>
      ) : null}
      <div className="space-y-3">
        <h1 className="h1">結果</h1>
        <p className="text-sm text-muted">
          {exam.name} / {formatDate(latest.finishedAt)}
          {isNewest ? null : "(過去の結果)"}
        </p>
        {isNewest ? null : (
          <a href={`/exams/${exam.examCode}/result`} className="text-sm text-primary hover:underline">
            最新の結果へ
          </a>
        )}
        {isNewest ? <Confetti reached={reached} perfect={perfect} /> : null}
      </div>

      <div className="space-y-8 lg:grid lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start lg:gap-8 lg:space-y-0">
        {/* 得点と操作は、広い画面では右に固定する(読む順では、先に置く) */}
        <aside
          aria-label="得点と操作"
          className="space-y-4 lg:sticky lg:top-4 lg:col-start-2 lg:row-start-1 lg:max-h-[calc(100vh-2rem)] lg:overflow-y-auto"
        >
          <div
            className={`card space-y-4 border-2 p-5 ${reached ? "border-correct bg-correct-bg" : "border-warn bg-warn-bg"} ${
              perfect ? "motion-shine" : ""
            }`}
          >
            <p className={`font-bold ${reached ? "text-correct" : "text-warn"}`}>
              <span aria-hidden="true">{reached ? "✓ " : "△ "}</span>
              {reached ? "合格ライン到達" : "合格ライン未達"}
            </p>
            <div className="flex flex-col items-center gap-4 sm:flex-row lg:flex-col">
              <ScoreRing percent={result.percent} reached={reached} />
              <div className="space-y-2">
                <p>
                  {result.total} 問中 {result.correct} 問が正解です。
                </p>
                {average !== null ? (
                  <p className="text-sm text-muted">平均回答時間 {formatAnswerTime(average)}/問</p>
                ) : null}
                <p className={`font-bold ${reached ? "text-correct" : "text-warn"}`}>
                  {reached
                    ? `合格ライン(${passLine}%)に達しています。この調子です。`
                    : `合格ライン(${passLine}%)まであと少しです。間違えた問題を見直しましょう。`}
                </p>
              </div>
            </div>
          </div>

          {domainRows.length > 0 ? (
            <div className="card space-y-3 p-4">
              <h2 className="h3">分野ごとの正答数</h2>
              <DomainBars caption="分野ごとの正答数" rows={domainRows} tableInSimple />
            </div>
          ) : null}

          {retryRows.length > 0 ? (
            <button
              type="button"
              onClick={retry}
              className="w-full rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
            >
              {`間違えた問題${retryRows.some((row) => row.unsure) ? "と自信なしの問題" : ""}だけで解き直す(${retryRows.length} 問)`}
            </button>
          ) : null}
          {retryError ? <Notice kind="error">{retryError}</Notice> : null}
          <div className="flex gap-3">
            <Link
              href={`/exams/${exam.examCode}`}
              className={`flex-1 rounded-md px-5 py-3 text-center font-bold ${
                retryRows.length > 0 ? "border border-line bg-surface" : "bg-primary text-on-primary hover:opacity-90"
              }`}
            >
              別の問題でもう一度
            </Link>
            <Link href="/exams" className="rounded-md border border-line bg-surface px-5 py-3 font-bold">
              資格の一覧へ
            </Link>
          </div>
        </aside>

        <div className="space-y-8 lg:col-start-1 lg:row-start-1">
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="h2">問題ごとの結果</h2>
              {wrongCount > 0 ? (
                <button
                  type="button"
                  aria-pressed={wrongOnly}
                  onClick={() => setWrongOnly(!wrongOnly)}
                  className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-bold"
                >
                  {wrongOnly ? "すべての問題を表示する" : `間違えた問題だけを見直す(${wrongCount} 問)`}
                </button>
              ) : null}
            </div>
            <BookmarkError bookmarks={bookmarks} />
            {wrongCount === 0 ? <p className="text-correct">すべて正解でした。見直す問題はありません。</p> : null}
            <ol className="motion-stagger space-y-4">
              {rows.map(({ question, number, correct, unsure, flagged, timeMs }) => (
                <li
                  key={question.questionId}
                  className={`card space-y-3 border-l-4 p-4 ${correct ? "border-l-correct" : "border-l-incorrect"}`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className={`font-bold ${correct ? "text-correct" : "text-incorrect"}`}>
                      <span className={correct ? "motion-stamp" : "motion-wrong inline-block"}>
                        {correct ? "○ 正解" : "× 不正解"}
                      </span>
                      <span className="ml-2 text-fg">問題 {number}</span>
                    </p>
                    <BookmarkToggle questionId={question.questionId} bookmarks={bookmarks} />
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <QuestionChips domains={exam.domains} question={question} />
                    {unsure ? <span className="chip tone-warn">自信なし</span> : null}
                    {flagged ? <span className="chip tone-orange">見直し</span> : null}
                    {timeMs !== undefined ? (
                      <span className="text-sm text-muted">回答時間 {formatAnswerTime(timeMs)}</span>
                    ) : null}
                  </div>
                  <RecentOutcomeMarks outcomes={outcomes.get(question.questionId) ?? []} />
                  <RichText text={question.questionText} />
                  {question.questionType === "free-text" ? (
                    <FreeTextDetail
                      question={question}
                      answer={textAnswerFor(latest.textAnswers, question.questionId)}
                    />
                  ) : (
                    <ChoiceDetail
                      question={question}
                      selected={answerFor(latest.answers, question.questionId)}
                      choiceOrder={latest.choiceOrder}
                    />
                  )}
                  <div className="space-y-2 border-t border-line pt-3">
                    <h3 className="font-bold">解説</h3>
                    <ExplanationView question={question} choiceOrder={latest.choiceOrder} headingLevel={4} />
                  </div>
                  <ReferenceList references={question.references} />
                </li>
              ))}
            </ol>
          </div>

          {previous.length > 0 ? (
            <div className="space-y-2">
              <h2 className="h2">これまでの結果</h2>
              <ul className="space-y-1 text-sm">
                {previous.map((past) => {
                  const pastScore = score(
                    past.questionIds.map((id) => byId.get(id)).filter((q) => q !== undefined),
                    past.answers,
                    past.textAnswers,
                  );
                  return (
                    <li
                      key={past.finishedAt}
                      className="flex justify-between rounded border border-line bg-surface p-2"
                    >
                      {/* 同じ画面の中で開き直すので、ページごと読み込む */}
                      <a
                        href={resultDetailHref(exam.examCode, past.finishedAt)}
                        className="text-primary hover:underline"
                      >
                        {formatDate(past.finishedAt)}
                      </a>
                      <span>
                        {pastScore.correct} / {pastScore.total} 問({pastScore.percent}%)
                      </span>
                    </li>
                  );
                })}
              </ul>
              <MoreResults
                examCode={exam.examCode}
                next={state.next}
                onMore={(more) =>
                  setState((current) =>
                    current.status === "ready"
                      ? { ...current, results: appendResults(current.results, more.results), next: more.next }
                      : current,
                  )
                }
              />
            </div>
          ) : null}
        </div>
      </div>
    </section>
  );
}

/** 択一・複数選択の問題の、選択肢ごとの正誤と回答 */
function ChoiceDetail({
  question,
  selected,
  choiceOrder,
}: {
  question: ChoiceQuestion;
  selected: readonly string[];
  choiceOrder: Result["choiceOrder"];
}) {
  const labels = displayLabels(orderChoices(question, choiceOrder));
  return (
    <>
      <ChoiceReview question={question} selected={selected} choiceOrder={choiceOrder} />
      <p className="text-sm text-muted">
        あなたの回答: {keysLabel(labelKeys(selected, labels))} / 正解:{" "}
        {keysLabel(labelKeys(question.correctAnswers, labels))}
      </p>
    </>
  );
}

/** 自由記述の問題の、回答と、観点ごとの判定と点数 */
function FreeTextDetail({ question, answer }: { question: FreeTextQuestion; answer: string }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <h3 className="font-bold">あなたの回答</h3>
        <p className="whitespace-pre-wrap rounded border border-line p-2">{answer.trim() === "" ? "未回答" : answer}</p>
      </div>
      <FreeTextScore rubric={question.rubric} answer={answer} />
    </div>
  );
}
