"use client";

import { useState } from "react";
import { Notice } from "@/components/notice.tsx";
import { fetchServerResultsPage, type ResultsPage } from "@/lib/history/client.ts";

type Props = {
  examCode: string;
  /** 続きを取る位置。null なら、ボタンを出さない */
  next: string | null;
  /** 続きを読めたとき。続きの取得が空なら、`next` が null のページを渡す(ボタンが消える) */
  onMore: (page: ResultsPage) => void;
};

/** 「これまでの結果」の続きを読む「もっと見る」。取得に失敗したときは、一覧をそのままにして、失敗を伝える。 */
export function MoreResults({ examCode, next, onMore }: Props) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  if (next === null) return null;

  async function load(before: string) {
    setBusy(true);
    setFailed(false);
    const page = await fetchServerResultsPage(examCode, before);
    setBusy(false);
    if (!page) {
      setFailed(true);
      return;
    }
    onMore(page.results.length === 0 ? { results: [], next: null } : page);
  }

  return (
    <div className="space-y-2">
      <button
        type="button"
        className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-bold disabled:opacity-50"
        disabled={busy}
        onClick={() => void load(next)}
      >
        {busy ? "読み込み中…" : "もっと見る"}
      </button>
      {failed ? <Notice kind="error">続きを読み込めませんでした。時間をおいて、もう一度お試しください。</Notice> : null}
    </div>
  );
}
