"use client";

import { useRouter } from "next/navigation";
import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { fetchNotebook, putNotebookEntry } from "@/lib/history/client.ts";
import {
  isEntryDone,
  type NotebookRecords,
  resumeEntryId,
  type SectionUnit,
  sectionKey,
} from "@/lib/notebook-review.ts";

/**
 * 体系ノートの完了の記録(節ごとの完了と、旧い中分類の履修済み)。アカウントから読む。
 * `records` は、読み込み中と、読めないとき(未ログイン・通信の失敗)、管理者のプレビューでは null(印・数・「続きから」を出さない)。
 */
export type NotebookProgress = {
  preview: boolean;
  /** `loading`: 読み込み中、`ready`: 読めた、`none`: 読めない(管理者のプレビューを含む) */
  status: "loading" | "ready" | "none";
  records: NotebookRecords | null;
  /** この画面で、最後に新しく完了にした節(押印の動きを、その節のページだけで出すため) */
  lastRecorded: { unit: string; entry: string } | null;
  /** 節を完了として記録する。記録できたら true。プレビューでは記録せず false */
  record: (unit: string, entry: string) => Promise<boolean>;
};

const NONE: NotebookProgress = {
  preview: true,
  status: "none",
  records: null,
  lastRecorded: null,
  record: async () => false,
};

const Context = createContext<NotebookProgress>(NONE);

export function useNotebookProgress(): NotebookProgress {
  return useContext(Context);
}

/** 体系ノートの完了の記録を読み、記録する。管理者のプレビュー(`preview`)では、読まず、記録もしない */
export function NotebookProgressProvider({
  examCode,
  preview,
  children,
}: {
  examCode: string;
  preview: boolean;
  children: ReactNode;
}) {
  const [records, setRecords] = useState<NotebookRecords | null>(null);
  const [status, setStatus] = useState<NotebookProgress["status"]>(preview ? "none" : "loading");
  const [lastRecorded, setLastRecorded] = useState<NotebookProgress["lastRecorded"]>(null);
  const latest = useRef(records);
  latest.current = records;

  useEffect(() => {
    if (preview) {
      setStatus("none");
      return;
    }
    let active = true;
    setStatus("loading");
    void fetchNotebook(examCode).then((data) => {
      if (!active) return;
      setRecords(data);
      setStatus(data ? "ready" : "none");
    });
    return () => {
      active = false;
    };
  }, [examCode, preview]);

  const record = useCallback(
    async (unit: string, entry: string) => {
      if (preview) return false;
      const wasDone = latest.current ? isEntryDone(latest.current, unit, entry) : false;
      if (!(await putNotebookEntry(examCode, unit, entry))) return false;
      // すぐに印を付ける(読めているときだけ。時刻はいま)。最初の時刻はサーバーが決めるので、読み直して、印と日付をそろえる
      setRecords((current) => {
        if (!current) return current;
        const key = sectionKey(unit, entry);
        if (current.entries.has(key)) return current;
        return { units: current.units, entries: new Map(current.entries).set(key, new Date().toISOString()) };
      });
      void fetchNotebook(examCode).then((fresh) => {
        if (!fresh) return;
        setRecords(fresh);
        setStatus("ready");
      });
      if (!wasDone) setLastRecorded({ unit, entry });
      return true;
    },
    [examCode, preview],
  );

  const value = useMemo(
    () => ({ preview, status, records, lastRecorded, record }),
    [preview, status, records, lastRecorded, record],
  );
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/**
 * 中分類の URL(`<basePath>/<中分類の ID>`)の移し先への切り替え。記録の読み込みが終わるまでは、最初の節を出したままにし、
 * 終わったら、最初の、完了していない節(すべて完了なら最初の節。読めないときと、管理者のプレビューでは最初の節)の URL に置き換える。
 */
export function NotebookResume({ unit, basePath }: { unit: SectionUnit; basePath: string }) {
  const router = useRouter();
  const { status, records } = useNotebookProgress();
  const target = resumeEntryId(unit, records);
  useEffect(() => {
    if (status === "loading" || !target) return;
    router.replace(`${basePath}/${unit.id}/${target}`);
  }, [status, target, router, basePath, unit.id]);
  return null;
}
