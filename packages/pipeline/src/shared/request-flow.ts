import { existsSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { type Kind, type Output, report } from "../log.ts";
import type { AgentStamp } from "./agents.ts";

/**
 * 依頼 → 取り込みの共通部品(ADR 0009)。段階ごとに違う検査(本文との照合、スタイル規則、来歴など)は段階の側に残し、
 * ここは、依頼の一覧、失敗の数え方、依頼のあとに入力が変わったときの扱い、取り込み済みの後始末だけを持つ。
 */

export interface FlowContext {
  output: Output;
  /** 報告の種類(例: `下書きの取り込みの停止`) */
  stopLabel: Kind;
  dryRun: boolean;
}

/** 依頼のファイル(`<鍵>.json`)の一覧。ファイル名の順 */
export function listRequestFiles(requestsDir: string): string[] {
  return existsSync(requestsDir)
    ? readdirSync(requestsDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
}

/** 読めない JSON は undefined */
export function readJsonFile(path: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return undefined;
  }
}

/** 取り込みの停止を、鍵と理由コードで報告する */
export function reportStop(ctx: FlowContext, key: string, reason: string): void {
  report(ctx.output, ctx.stopLabel, `${key} ${reason}`);
}

/**
 * 出力が検査に通らなかった: 報告し、鍵ごとの失敗の回数を足し、出力を消す(エージェントが書き直せるようにする)。
 * 回数の上限は、依頼を書く側が見る。
 */
export function failOutput(
  ctx: FlowContext,
  key: string,
  reason: string,
  outPath: string,
  attempts: Record<string, number>,
): void {
  reportStop(ctx, key, reason);
  if (ctx.dryRun) return;
  attempts[key] = (attempts[key] ?? 0) + 1;
  rmSync(outPath, { force: true });
}

/** 依頼のあとに入力が変わった: 取り込まず、依頼と出力を捨てる(次の依頼で作り直す。失敗の回数には数えない) */
export function discardStale(ctx: FlowContext, key: string, requestPath: string, outPath: string): void {
  reportStop(ctx, key, "request-stale");
  if (ctx.dryRun) return;
  rmSync(requestPath, { force: true });
  rmSync(outPath, { force: true });
}

/** 依頼のあとに、エージェントの定義(指示またはモデル)が変わったか */
export function definitionChanged(request: { agent?: AgentStamp | undefined }, current: AgentStamp): boolean {
  return request.agent === undefined || request.agent.definitionHash !== current.definitionHash;
}

/** 取り込み済みの依頼と出力を消す */
export function cleanupImported(files: readonly string[], requestsDir: string, outDir: string): void {
  for (const file of files) {
    rmSync(join(requestsDir, file), { force: true });
    rmSync(join(outDir, file), { force: true });
  }
}
