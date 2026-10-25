#!/usr/bin/env node
/**
 * PreToolUse のフック本体。承認の印なしの push と、PR・Issue の作成・編集を止める。
 * 権限の確認を省く動作モードでも効くよう、止めるときは終了コード 2 を返す。
 * このスクリプト自身のエラーでも素通りさせない(終了コード 2 以外の失敗は、呼び出しを通してしまう)。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { approvalPath, decideHook, type HookInput, type Probe, readApprovals, sha256 } from "./lib/approval.ts";

function run(cwd: string, args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

try {
  const input = JSON.parse(readFileSync(0, "utf8")) as HookInput & { cwd?: string };
  const cwd = input.cwd ?? process.cwd();
  const probe = (): Probe => ({
    branch: run(cwd, ["branch", "--show-current"]),
    head: run(cwd, ["rev-parse", "HEAD"]),
    countFrom: (base) => {
      try {
        return Number(run(cwd, ["rev-list", "--count", `${base}..HEAD`]));
      } catch {
        return null;
      }
    },
    hashOf: (path) => {
      try {
        return sha256(readFileSync(resolve(cwd, path)));
      } catch {
        return null;
      }
    },
  });
  // 承認が要る操作のときだけ読む。承認の置き場を求める git が、無関係なコマンドで失敗して止めないため
  const approvals = () =>
    readApprovals(approvalPath(run(cwd, ["rev-parse", "--path-format=absolute", "--git-common-dir"])));
  const decision = decideHook(input, approvals, Date.now(), probe);
  if (!decision.ok) {
    process.stderr.write(`${decision.reason}\n`);
    process.exitCode = 2;
  }
} catch (error) {
  process.stderr.write(`承認の確認に失敗したため止めました: ${(error as Error).message}\n`);
  process.exitCode = 2;
}
