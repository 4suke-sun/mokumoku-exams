import type { AgentStamp } from "../shared/agents.ts";
import { chunk, waitingRequests } from "../shared/bundles.ts";
import { VerifyRequestSchema } from "./request.ts";

/**
 * 検証役に 1 回の起動で渡す依頼の束を組む(検証と、検証役の評価で同じ形)。読むだけで、何も書かない。
 * - 対象は、出力がまだない依頼(待っている依頼)だけ。出し直しの回数が上限に達した依頼と、定義が変わった依頼は除き、件数を返す(shared/bundles.ts の waitingRequests)。
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
  const waiting = waitingRequests({
    ...args,
    parse: (raw) => {
      const parsed = VerifyRequestSchema.safeParse(raw);
      return parsed.success ? parsed.data : undefined;
    },
  });
  const bundles: RequestBundle[] = [];
  for (const check of ["rederive", "explanation"] as const) {
    const files = waiting.requests.filter((r) => r.request.check === check).map((r) => r.path);
    for (const part of chunk(files, args.size)) bundles.push({ check, files: part });
  }
  return { bundles, invalid: waiting.invalid, exhausted: waiting.exhausted, stale: waiting.stale };
}
