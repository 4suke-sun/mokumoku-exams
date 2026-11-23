import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { AgentStamp } from "./agents.ts";
import { definitionChanged, listRequestFiles, readJsonFile } from "./request-flow.ts";

/**
 * 役の 1 回の起動に渡す依頼の束を組むための、待っている依頼の選び出し(依頼の形の検査を引数で受け取り、役ごとの依頼に使える。いまは検証と検証役の評価で使う)。読むだけで、何も書かない。
 * - 対象は、出力がまだない依頼(待っている依頼)だけ。依頼のファイル名の順に並べる。
 * - 出し直しの回数(鍵ごと。取り込みで出力が形の検査に落ちた回数)が上限に達した依頼は、選ばず、exhausted に数える(取り込みが先へ進めない依頼のため)。
 * - 依頼のあとに役の定義(指示またはモデル)が変わった依頼は、選ばず、stale に数える(依頼の鍵が定義のハッシュを含むので、依頼を書くコマンドが新しい鍵の依頼を書く)。
 *   上限と定義の変化の両方に当たる依頼は、stale に数える(定義が変わると鍵が変わり、回数は新しい鍵で数え直すため)。
 * - 読めない依頼のファイルは、選ばず、invalid に返す(呼び出し側が、入力の誤りとして報告する)。
 */
export function waitingRequests<T extends { agent?: AgentStamp | undefined }>(args: {
  rootDir: string;
  requestsDir: string;
  outDir: string;
  /** 依頼の形の検査。読めないときは undefined */
  parse: (raw: unknown) => T | undefined;
  /** 鍵ごとの出し直しの回数(作業用の置き場の state.json) */
  attempts: Readonly<Record<string, number>>;
  /** 出し直しの回数の上限 */
  maxAttempts: number;
  /** 現在の役の定義 */
  stamp: AgentStamp;
}): { requests: { path: string; request: T }[]; invalid: string[]; exhausted: number; stale: number } {
  const requests: { path: string; request: T }[] = [];
  const invalid: string[] = [];
  let exhausted = 0;
  let stale = 0;
  for (const file of listRequestFiles(args.requestsDir)) {
    if (existsSync(join(args.outDir, file))) continue;
    const path = relative(args.rootDir, join(args.requestsDir, file));
    const request = args.parse(readJsonFile(join(args.requestsDir, file)));
    if (request === undefined) {
      invalid.push(path);
      continue;
    }
    if (definitionChanged(request, args.stamp)) {
      stale++;
      continue;
    }
    if ((args.attempts[basename(file, ".json")] ?? 0) >= args.maxAttempts) {
      exhausted++;
      continue;
    }
    requests.push({ path, request });
  }
  return { requests, invalid, exhausted, stale };
}

/** 並びを size 件ずつに区切る(最後の束は size 未満になりうる) */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** 作業用の置き場の state.json(鍵ごとの出し直しの回数)を読む。読めないときは空 */
export function readAttemptsFile(path: string): Record<string, number> {
  const raw = readJsonFile(path);
  return raw !== null && typeof raw === "object"
    ? (Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number")) as Record<string, number>)
    : {};
}
