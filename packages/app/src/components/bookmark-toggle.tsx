"use client";

import { useCallback, useEffect, useState } from "react";
import { fetchBookmarks, putBookmark } from "@/lib/history/client.ts";
import { Notice } from "./notice.tsx";

export type Bookmarks = {
  /** ブックマークした問題 ID。読み込み中、または取得できなかったときは null */
  ids: ReadonlySet<string> | null;
  /** 付ける・外す。保存できなければ、元に戻して false を返す。 */
  toggle: (questionId: string) => Promise<boolean>;
  /** 直前の保存に失敗した */
  failed: boolean;
  /** この画面で、一度でも切り替えた問題 ID */
  touched: ReadonlySet<string>;
};

/** 資格のブックマークを、アカウントから読み込んで扱う。 */
export function useBookmarks(examCode: string): Bookmarks {
  const [ids, setIds] = useState<ReadonlySet<string> | null>(null);
  const [failed, setFailed] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => {
    let active = true;
    void fetchBookmarks(examCode).then((found) => {
      if (!active) return;
      // 取得できないとき(通信の失敗など)は、切り替えを押せなくするだけにする
      setIds(found ? new Set(found) : null);
    });
    return () => {
      active = false;
    };
  }, [examCode]);

  const toggle = useCallback(
    async (questionId: string) => {
      if (!ids) return false;
      const next = !ids.has(questionId);
      const apply = (on: boolean) =>
        setIds((current) => {
          const updated = new Set(current);
          if (on) updated.add(questionId);
          else updated.delete(questionId);
          return updated;
        });
      // 先に表示を変え、保存できなかったら戻す
      apply(next);
      setTouched((current) => new Set(current).add(questionId));
      const saved = await putBookmark(examCode, questionId, next);
      if (!saved) apply(!next);
      setFailed(!saved);
      return saved;
    },
    [examCode, ids],
  );

  return { ids, toggle, failed, touched };
}

type Props = { questionId: string; bookmarks: Bookmarks };

/** 問題ごとのブックマークの切り替え。ブックマークを読み込めないときは、押せなくする。 */
export function BookmarkToggle({ questionId, bookmarks }: Props) {
  const on = bookmarks.ids?.has(questionId) ?? false;
  return (
    <button
      type="button"
      aria-pressed={on}
      disabled={bookmarks.ids === null}
      onClick={() => void bookmarks.toggle(questionId)}
      className={`rounded-md border px-3 py-1 text-sm font-bold disabled:opacity-50 ${
        on ? "border-primary text-primary" : "border-line"
      }`}
    >
      <span aria-hidden="true">{on ? "★ " : "☆ "}</span>
      {on ? "ブックマーク済み" : "ブックマーク"}
    </button>
  );
}

/** ブックマークを保存できなかったときの知らせ */
export function BookmarkError({ bookmarks }: { bookmarks: Bookmarks }) {
  return bookmarks.failed ? (
    <Notice kind="error" className="text-sm">
      ブックマークを保存できませんでした。時間をおいて、もう一度お試しください。
    </Notice>
  ) : null;
}
