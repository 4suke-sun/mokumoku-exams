"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BookmarkError, BookmarkToggle, useBookmarks } from "@/components/bookmark-toggle.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { InlineText, RichText } from "@/components/rich-text.tsx";
import { ScoreRing } from "@/components/score-ring.tsx";
import { judgeFreeText } from "@/lib/free-text.ts";
import { fetchServerResults, postServerResult } from "@/lib/history/client.ts";
import { mergeResults, pendingMigration } from "@/lib/history/merge.ts";
import { answerFor, isQuestionCorrect, orderChoices, passLinePercent, score, textAnswerFor } from "@/lib/quiz.ts";
import { recentOutcomes } from "@/lib/recent-outcomes.ts";
import {
  browserStore,
  clearResults,
  loadResults,
  loadStageProgress,
  type Result,
  type StageCheck,
} from "@/lib/storage.ts";
import { STAGE_PASS_PERCENT } from "@/lib/study-stages.ts";
import type { ChoiceQuestion, FreeTextQuestion, PublishedExam, Question } from "@/lib/types.ts";

type Props = { exam: PublishedExam; questions: Question[] };

type State =
  | { status: "loading" }
  // source: 結果の取得元。server はアカウントに保存した記録、local は(サーバーに接続できないときの)この端末の記録。
  // pending: この端末にだけ残っていて、まだアカウントに移していない記録
  | { status: "ready"; results: Result[]; source: "server" | "local"; pending: Result[] };

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString("ja-JP", { dateStyle: "medium", timeStyle: "short" });
}

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

export function ResultView({ exam, questions }: Props) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [wrongOnly, setWrongOnly] = useState(false);
  const [migration, setMigration] = useState<"idle" | "busy" | "failed">("idle");
  const [stageCheck, setStageCheck] = useState<StageCheck | null>(null);
  const bookmarks = useBookmarks(exam.examCode);

  useEffect(() => {
    let active = true;
    void (async () => {
      const local = loadResults(browserStore(), exam.examCode);
      setStageCheck(loadStageProgress(browserStore(), exam.examCode).last ?? null);
      const server = await fetchServerResults(exam.examCode);
      if (!active) return;
      if (server === null) {
        setState({ status: "ready", results: local, source: "local", pending: [] });
        return;
      }
      const pending = pendingMigration(local, server);
      setState({ status: "ready", results: mergeResults(server, pending), source: "server", pending });
    })();
    return () => {
      active = false;
    };
  }, [exam.examCode]);

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
    return <p className="text-muted">読み込んでいます…</p>;
  }

  const [latest, ...previous] = state.results;
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const answered = latest
    ? latest.questionIds.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined)
    : [];

  if (!latest || answered.length === 0) {
    return (
      <EmptyState
        title="結果がありません"
        description="問題を解くと、ここに結果が表示されます。"
        action={{ label: "モード選択へ", href: `/exams/${exam.examCode}` }}
      />
    );
  }

  const result = score(answered, latest.answers, latest.textAnswers);
  const allRows = answered.map((question, i) => ({
    question,
    number: i + 1,
    correct: isQuestionCorrect(question, latest.answers, latest.textAnswers),
  }));
  const wrongCount = allRows.filter((row) => !row.correct).length;
  // 保存した結果(最大 10 回)から、問題ごとの直近の正誤を出す(新しく保存はしない)
  const outcomes = recentOutcomes(state.results, questions);
  // 見直すときも、元の問題番号を保つ(「問題 3」は、結果の中の 3 問目のまま)
  const rows = wrongOnly ? allRows.filter((row) => !row.correct) : allRows;
  const passLine = passLinePercent(exam);
  const reached = result.percent >= passLine;
  // 直近の結果が段階の確認問題のときだけ、段階の合否を伝える
  const stage = stageCheck && stageCheck.finishedAt === latest.finishedAt ? stageCheck : null;

  return (
    <section className="space-y-8">
      {state.source === "local" ? (
        <p role="status" className="text-sm text-muted">
          サーバーに接続できないため、この端末に保存した記録を表示しています。
        </p>
      ) : null}
      {state.pending.length > 0 ? (
        <div role="status" className="space-y-2 rounded-lg border border-line bg-surface p-4">
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
            <p role="alert" className="text-incorrect">
              移せなかった記録があります。時間をおいて、もう一度お試しください。
            </p>
          ) : null}
        </div>
      ) : null}
      {stage ? (
        <div role="status" className="space-y-2 rounded-lg border border-line bg-surface p-4">
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
      <div className="space-y-3">
        <h1 className="text-2xl font-bold">結果</h1>
        <p className="text-sm text-muted">
          {exam.name} / {formatDate(latest.finishedAt)}
        </p>
        <div className="flex flex-col items-center gap-5 rounded-lg border border-line bg-surface p-5 sm:flex-row">
          <ScoreRing percent={result.percent} reached={reached} />
          <div>
            <p>
              {result.total} 問中 {result.correct} 問が正解です。
            </p>
            <p className={`mt-2 font-bold ${reached ? "text-correct" : "text-warn"}`}>
              {reached
                ? `合格ライン(${passLine}%)に達しています。この調子です。`
                : `合格ライン(${passLine}%)まであと少しです。間違えた問題を見直しましょう。`}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-bold">問題ごとの結果</h2>
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
        <ol className="space-y-4">
          {rows.map(({ question, number, correct }) => (
            <li key={question.questionId} className="space-y-3 rounded-lg border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={`font-bold ${correct ? "text-correct" : "text-incorrect"}`}>
                  {correct ? "○ 正解" : "× 不正解"}
                  <span className="ml-2 text-fg">問題 {number}</span>
                </p>
                <BookmarkToggle questionId={question.questionId} bookmarks={bookmarks} />
              </div>
              <RecentOutcomeMarks outcomes={outcomes.get(question.questionId) ?? []} />
              <RichText text={question.questionText} />
              {question.questionType === "free-text" ? (
                <FreeTextDetail question={question} answer={textAnswerFor(latest.textAnswers, question.questionId)} />
              ) : (
                <ChoiceDetail
                  question={question}
                  selected={answerFor(latest.answers, question.questionId)}
                  choiceOrder={latest.choiceOrder}
                />
              )}
              <div className="space-y-2 border-t border-line pt-3">
                <h3 className="font-bold">解説</h3>
                <RichText text={question.explanation} />
              </div>
              {question.supplement ? <RichText text={question.supplement} className="text-sm text-muted" /> : null}
            </li>
          ))}
        </ol>
      </div>

      {previous.length > 0 ? (
        <div className="space-y-2">
          <h2 className="text-lg font-bold">これまでの結果</h2>
          <ul className="space-y-1 text-sm">
            {previous.map((past) => {
              const pastScore = score(
                past.questionIds.map((id) => byId.get(id)).filter((q): q is Question => q !== undefined),
                past.answers,
                past.textAnswers,
              );
              return (
                <li key={past.finishedAt} className="flex justify-between rounded border border-line bg-surface p-2">
                  <span>{formatDate(past.finishedAt)}</span>
                  <span>
                    {pastScore.correct} / {pastScore.total} 問({pastScore.percent}%)
                  </span>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}

      <div className="flex gap-3">
        <Link
          href={`/exams/${exam.examCode}`}
          className="flex-1 rounded-md bg-primary px-5 py-3 text-center font-bold text-on-primary hover:opacity-90"
        >
          もう一度解く
        </Link>
        <Link href="/exams" className="rounded-md border border-line bg-surface px-5 py-3 font-bold">
          資格の一覧へ
        </Link>
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
  return (
    <>
      <ul className="space-y-1 text-sm">
        {orderChoices(question, choiceOrder).map((choice) => {
          const isAnswer = question.correctAnswers.includes(choice.key);
          const chosen = selected.includes(choice.key);
          return (
            <li key={choice.key} className="rounded border border-line p-2">
              <span className="font-bold">{choice.key}. </span>
              <InlineText text={choice.text} />
              {isAnswer ? <span className="ml-2 font-bold text-correct">(正解)</span> : null}
              {chosen ? <span className="ml-2 text-muted">(あなたの回答)</span> : null}
              {choice.explanation ? (
                <p className="mt-1 text-muted">
                  <span className={`font-bold ${isAnswer ? "text-correct" : "text-incorrect"}`}>
                    {isAnswer ? "正解の理由: " : "不正解の理由: "}
                  </span>
                  <InlineText text={choice.explanation} />
                </p>
              ) : null}
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-muted">
        あなたの回答: {keysLabel(selected)} / 正解: {keysLabel(question.correctAnswers)}
      </p>
    </>
  );
}

/** 自由記述の問題の、回答と、観点ごとの判定と点数 */
function FreeTextDetail({ question, answer }: { question: FreeTextQuestion; answer: string }) {
  const judgement = judgeFreeText(question.rubric, answer);
  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1">
        <h3 className="font-bold">あなたの回答</h3>
        <p className="whitespace-pre-wrap rounded border border-line p-2">{answer.trim() === "" ? "未回答" : answer}</p>
      </div>
      <div className="space-y-1">
        <h3 className="font-bold">観点ごとの判定</h3>
        <ul className="space-y-1">
          {judgement.criteria.map((criterion) => (
            <li key={criterion.name} className="flex justify-between gap-3 rounded border border-line p-2">
              <span className={criterion.met ? "text-correct" : "text-incorrect"}>
                {criterion.met ? "○ 満たしている" : "× 満たしていない"}
                <span className="ml-2 text-fg">{criterion.name}</span>
              </span>
              <span>
                {criterion.met ? criterion.points : 0} / {criterion.points} 点
              </span>
            </li>
          ))}
        </ul>
      </div>
      <p className="text-muted">
        得点: {judgement.earned} / {judgement.total} 点(合格点 {judgement.passingPoints} 点)
      </p>
    </div>
  );
}
