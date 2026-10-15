"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Notice } from "@/components/notice.tsx";
import { PlaySkeleton } from "@/components/page-skeletons.tsx";
import { Player } from "@/components/player.tsx";
import { fetchQuestions } from "@/lib/questions/client.ts";
import { browserStore, loadSession } from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { useStorageOwner } from "@/lib/use-storage-owner.ts";

type State = { status: "loading" } | { status: "ready"; questions: Question[] } | { status: "failed" };

/**
 * 出題の画面。出題中の問題(端末に保存した出題の状態)だけを、開いたあとにアカウントから取って、出題に渡す
 * (資格の全問を、画面の応答に入れない)。出題の状態がなければ、問題を取らずに、出題の画面の「出題がない」表示にする。
 */
export function PlayLoader({ exam }: { exam: PublishedExam }) {
  const [state, setState] = useState<State>({ status: "loading" });
  const owner = useStorageOwner();

  useEffect(() => {
    // 持ち主の印が取れるまでは、端末の記録を読まない
    if (owner === undefined) return;
    let active = true;
    const ids = loadSession(browserStore(), exam.examCode)?.questionIds ?? [];
    if (ids.length === 0) {
      setState({ status: "ready", questions: [] });
      return;
    }
    void fetchQuestions(exam.examCode, ids).then((questions) => {
      if (active) setState(questions ? { status: "ready", questions } : { status: "failed" });
    });
    return () => {
      active = false;
    };
  }, [exam.examCode, owner]);

  if (state.status === "loading") return <PlaySkeleton />;
  if (state.status === "failed") {
    return (
      <section className="space-y-4">
        <Notice kind="error">問題を読み込めませんでした。時間をおいて、開き直してください。</Notice>
        <Link href={`/exams/${exam.examCode}`} className="text-primary hover:underline">
          モード選択へ戻る
        </Link>
      </section>
    );
  }
  return <Player exam={exam} questions={state.questions} />;
}
