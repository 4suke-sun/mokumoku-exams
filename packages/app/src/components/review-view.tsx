"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { EmptyState } from "@/components/empty-state.tsx";
import { Notice } from "@/components/notice.tsx";
import { ListSkeleton } from "@/components/page-skeletons.tsx";
import { fetchReviewItems, type ReviewItemView, removeReview } from "@/lib/history/client.ts";
import { MASTER_STREAK } from "@/lib/history/schema.ts";
import { SESSION_SAVE_FAILED, startSession } from "@/lib/start-session.ts";
import { browserStore } from "@/lib/storage.ts";

export type ReviewExam = {
  examCode: string;
  name: string;
  /** 資格の問題(一覧に出す題の抜き出しと、出題に使う選択肢のキー) */
  questions: { questionId: string; excerpt: string; choiceKeys: string[] }[];
};

type State = { status: "loading" } | { status: "error" } | { status: "ready"; items: ReviewItemView[] };

/**
 * 復習の画面。すべての資格の、まだマスターしていない問題を一覧し、資格ごとに復習の出題を始められる。
 * 2 回続けて正解するとマスターになる。手で外すこともできる。
 */
export function ReviewView({ exams }: { exams: ReviewExam[] }) {
  const router = useRouter();
  const [state, setState] = useState<State>({ status: "loading" });
  const [message, setMessage] = useState<{ kind: "error" | "success"; text: string } | null>(null);

  useEffect(() => {
    let active = true;
    void fetchReviewItems().then((items) => {
      if (active) setState(items ? { status: "ready", items } : { status: "error" });
    });
    return () => {
      active = false;
    };
  }, []);

  if (state.status === "loading") return <ListSkeleton />;
  if (state.status === "error") {
    return (
      <section className="space-y-4">
        <h1 className="h1">復習</h1>
        <Notice kind="error">復習の一覧を読み込めませんでした。時間をおいて、もう一度お試しください。</Notice>
      </section>
    );
  }

  const known = new Map(exams.map((exam) => [exam.examCode, exam]));
  // 公開中の資格の、いまのデータにある問題だけを出す
  const items = state.items.filter((item) =>
    known.get(item.examCode)?.questions.some((q) => q.questionId === item.questionId),
  );
  const groups = exams
    .map((exam) => ({
      exam,
      waiting: items.filter((i) => i.examCode === exam.examCode && !i.mastered),
      mastered: items.filter((i) => i.examCode === exam.examCode && i.mastered).length,
    }))
    .filter((group) => group.waiting.length > 0 || group.mastered > 0);
  const waitingTotal = groups.reduce((sum, g) => sum + g.waiting.length, 0);

  async function remove(item: ReviewItemView) {
    if (!(await removeReview(item.examCode, item.questionId))) {
      setMessage({ kind: "error", text: "復習から外せませんでした。時間をおいて、もう一度お試しください。" });
      return;
    }
    setState((current) =>
      current.status === "ready"
        ? {
            ...current,
            items: current.items.filter((i) => !(i.examCode === item.examCode && i.questionId === item.questionId)),
          }
        : current,
    );
    setMessage({ kind: "success", text: "復習から外しました。" });
  }

  function start(exam: ReviewExam, waiting: readonly ReviewItemView[]) {
    const ids = new Set(waiting.map((i) => i.questionId));
    const picked = exam.questions.filter((q) => ids.has(q.questionId));
    const href = startSession(browserStore(), exam.examCode, picked);
    if (!href) {
      setMessage({ kind: "error", text: SESSION_SAVE_FAILED });
      return;
    }
    router.push(href);
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <h1 className="h1">復習</h1>
        <p className="text-muted">
          間違えた問題と、自信なしの印を付けた問題です。{MASTER_STREAK}{" "}
          回続けて正解すると、マスターになって一覧から外れます。
        </p>
      </div>
      {message ? <Notice kind={message.kind}>{message.text}</Notice> : null}
      {groups.length === 0 ? (
        <EmptyState
          icon="🎉"
          title="復習を待っている問題はありません"
          description="間違えた問題があると、ここに並びます。"
          action={{ label: "資格を選ぶ", href: "/exams" }}
        />
      ) : (
        <>
          <p className="font-bold" aria-live="polite">
            復習を待っている問題: {waitingTotal} 問
          </p>
          {groups.map(({ exam, waiting, mastered }) => (
            <section key={exam.examCode} aria-labelledby={`review-${exam.examCode}`} className="card space-y-3 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 id={`review-${exam.examCode}`} className="h2">
                  {exam.name}
                </h2>
                <span className="text-sm text-muted">
                  待ち {waiting.length} 問 / マスター済み {mastered} 問
                </span>
              </div>
              {waiting.length > 0 ? (
                <button
                  type="button"
                  onClick={() => start(exam, waiting)}
                  className="rounded-md bg-primary px-4 py-2 font-bold text-on-primary hover:opacity-90"
                >
                  復習する({waiting.length} 問)
                </button>
              ) : null}
              <ul className="space-y-2">
                {waiting.map((item) => {
                  const question = exam.questions.find((q) => q.questionId === item.questionId);
                  return (
                    <li
                      key={item.questionId}
                      className="flex flex-wrap items-start justify-between gap-2 rounded-md border border-line p-3"
                    >
                      <div className="min-w-0 flex-1 space-y-1">
                        <p className="text-sm">{question?.excerpt}</p>
                        <p className="text-xs text-muted">
                          {item.questionId} / 連続正解 {item.streak} / {MASTER_STREAK}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => void remove(item)}
                        aria-label={`${item.questionId}を復習から外す`}
                        className="rounded-md border border-line px-3 py-1 text-sm"
                      >
                        外す
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </>
      )}
    </section>
  );
}
