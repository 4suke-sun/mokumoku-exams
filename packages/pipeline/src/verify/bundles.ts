import { existsSync } from "node:fs";
import { basename, join, relative } from "node:path";
import type { AgentStamp } from "../shared/agents.ts";
import { definitionChanged, listRequestFiles, readJsonFile } from "../shared/request-flow.ts";
import { VerifyRequestSchema } from "./request.ts";

/**
 * 検証役に 1 回の起動で渡す依頼の束を組む(検証と、検証役の評価で同じ形)。読むだけで、何も書かない。
 * - 対象は、出力がまだない依頼(待っている依頼)だけ。
 * - 出し直しの回数(鍵ごと。取り込みで出力が形の検査に落ちた回数)が上限に達した依頼は、束に入れず、exhausted に数える(取り込みが先へ進めない依頼のため)。
 * - 依頼のあとに検証役の定義(指示またはモデル)が変わった依頼は、束に入れず、stale に数える(取り込みが request-stale で捨て、依頼を書く側が作り直す)。
 * - 束は、同じ check の依頼だけで組む。再導出(rederive)を先に、解説の確認(explanation)をあとに並べる。
 * - check ごとに、依頼のファイル名の順に、size 件ずつ区切る。
 * - 読めない依頼のファイルは、束に入れず、invalid に返す(呼び出し側が、入力の誤りとして報告する)。
 */
export interface RequestBundle {
  check: "rederive" | "explanation";
  /** 依頼のファイルの場所(rootDir からの相対パス) */
  files: string[];
}

export function bundleRequests(args: {
  rootDir: string;
  requestsDir: string;
  outDir: string;
  size: number;
  /** 鍵ごとの出し直しの回数(作業用の置き場の state.json) */
  attempts: Readonly<Record<string, number>>;
  /** 出し直しの回数の上限(検証は verify.maxAttempts、評価は eval.maxAttempts) */
  maxAttempts: number;
  /** 現在の検証役の定義 */
  stamp: AgentStamp;
}): { bundles: RequestBundle[]; invalid: string[]; exhausted: number; stale: number } {
  const byCheck: Record<RequestBundle["check"], string[]> = { rederive: [], explanation: [] };
  const invalid: string[] = [];
  let exhausted = 0;
  let stale = 0;
  for (const file of listRequestFiles(args.requestsDir)) {
    if (existsSync(join(args.outDir, file))) continue;
    const path = join(args.requestsDir, file);
    const parsed = VerifyRequestSchema.safeParse(readJsonFile(path));
    if (!parsed.success) {
      invalid.push(relative(args.rootDir, path));
      continue;
    }
    if ((args.attempts[basename(file, ".json")] ?? 0) >= args.maxAttempts) {
      exhausted++;
      continue;
    }
    if (definitionChanged(parsed.data, args.stamp)) {
      stale++;
      continue;
    }
    byCheck[parsed.data.check].push(relative(args.rootDir, path));
  }
  const bundles: RequestBundle[] = [];
  for (const check of ["rederive", "explanation"] as const) {
    const files = byCheck[check];
    for (let i = 0; i < files.length; i += args.size) bundles.push({ check, files: files.slice(i, i + args.size) });
  }
  return { bundles, invalid, exhausted, stale };
}
