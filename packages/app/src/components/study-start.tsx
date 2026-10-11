"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { newSession } from "@/lib/quiz.ts";
import { browserStore, loadSession, loadSettings, saveSession } from "@/lib/storage.ts";

type Props = {
  examCode: string;
  /** 単元に関連する問題(この順に出題する) */
  items: { questionId: string; choiceKeys: string[] }[];
};

/** 学習モードの「この単元の問題を解く」。単元に関連する問題だけで出題を始める。 */
export function StudyStart({ examCode, items }: Props) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(false);

  useEffect(() => {
    setHasSession(loadSession(browserStore(), examCode) !== null);
  }, [examCode]);

  function start() {
    if (items.length === 0) {
      setError("この単元には、出題できる問題がありません。");
      return;
    }
    const store = browserStore();
    const { shuffleChoices } = loadSettings(store);
    if (!saveSession(store, newSession(examCode, items, { shuffleChoices }, Math.random, new Date()))) {
      setError("この端末では、出題の状態を保存できません。ブラウザの設定を確認してください。");
      return;
    }
    router.push(`/exams/${examCode}/play`);
  }

  return (
    <div className="space-y-2">
      {hasSession ? (
        <p className="text-sm text-muted">出題の途中の状態があります。新しく始めると、その続きは消えます。</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-incorrect">
          {error}
        </p>
      ) : null}
      <button
        type="button"
        onClick={start}
        disabled={items.length === 0}
        className="w-full rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
      >
        この単元の問題を解く({items.length} 問)
      </button>
    </div>
  );
}
