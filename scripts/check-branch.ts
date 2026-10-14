#!/usr/bin/env node
/**
 * pre-commit のフック本体。main への直接の commit を止める。
 * このスクリプト自身のエラーでも素通りさせない。
 */
import { execFileSync } from "node:child_process";
import { checkBranch } from "./lib/branch-check.ts";

try {
  // detached HEAD では symbolic-ref が失敗し、空になる
  const branch =
    execFileSync("git", ["symbolic-ref", "--short", "-q", "HEAD"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || null;
  const result = checkBranch(branch);
  if (!result.ok) {
    process.stderr.write(`${result.message}\n`);
    process.exitCode = 1;
  }
} catch (error) {
  // symbolic-ref -q は detached HEAD で終了コード 1 を返すだけ。それ以外の失敗は止める
  if ((error as { status?: number }).status === 1) {
    process.exitCode = 0;
  } else {
    process.stderr.write("コミットを中止しました。ブランチを判定できませんでした(git の実行に失敗)。\n");
    process.exitCode = 1;
  }
}
