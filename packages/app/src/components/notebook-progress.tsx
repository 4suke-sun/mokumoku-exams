"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { fetchNotebookUnits, putNotebookUnit } from "@/lib/history/client.ts";

/**
 * 体系ノートの履修済み(中分類の ID から、最初に履修した時刻)。アカウントから読む。
 * `completed` は、読み込み中と、読めないとき(未ログイン・通信の失敗)、管理者のプレビューでは null(印を出さない)。
 */
export type NotebookProgress = {
  preview: boolean;
  completed: ReadonlyMap<string, string> | null;
  /** 中分類を履修済みとして記録する。記録できたら true。プレビューでは記録せず false */
  record: (unit: string) => Promise<boolean>;
};

const NONE: NotebookProgress = { preview: true, completed: null, record: async () => false };

const Context = createContext<NotebookProgress>(NONE);

export function useNotebookProgress(): NotebookProgress {
  return useContext(Context);
}

/** 体系ノートの履修済みを読み、記録する。管理者のプレビュー(`preview`)では、読まず、記録もしない */
export function NotebookProgressProvider({
  examCode,
  preview,
  children,
}: {
  examCode: string;
  preview: boolean;
  children: ReactNode;
}) {
  const [completed, setCompleted] = useState<ReadonlyMap<string, string> | null>(null);

  useEffect(() => {
    if (preview) return;
    let active = true;
    void fetchNotebookUnits(examCode).then((units) => {
      if (active && units) setCompleted(units);
    });
    return () => {
      active = false;
    };
  }, [examCode, preview]);

  const record = useCallback(
    async (unit: string) => {
      if (preview) return false;
      if (!(await putNotebookUnit(examCode, unit))) return false;
      // 最初の時刻はサーバーが決める。読み直して、印と日付をそろえる(読めなければ、いまの時刻で印だけを付ける)
      const units = await fetchNotebookUnits(examCode);
      setCompleted((current) => {
        if (units) return units;
        const next = new Map(current ?? []);
        if (!next.has(unit)) next.set(unit, new Date().toISOString());
        return next;
      });
      return true;
    },
    [examCode, preview],
  );

  const value = useMemo(() => ({ preview, completed, record }), [preview, completed, record]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
