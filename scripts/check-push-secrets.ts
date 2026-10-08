#!/usr/bin/env node
/**
 * push 前のフック本体(.githooks/pre-push から呼ばれる)。標準入力は
 * `<ローカルref> <ローカルSHA> <リモートref> <リモートSHA>` の行。
 * 範囲内の全コミットの、追加行・ファイル名・変更範囲・メッセージ・作者を検査する。
 * 失敗したら push を止める(このスクリプト自身のエラーでも素通りさせない)。
 */
import { readFileSync } from "node:fs";
import { ZERO_SHA, baseFor, checkCommits, checkEachCommit, report } from "./lib/git-check.ts";

const lines = readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
const blocks: string[] = [];
const warns: string[] = [];

try {
  for (const line of lines) {
    const [, localSha, remoteRef, remoteSha] = line.split(/\s+/);
    if (!localSha || localSha === ZERO_SHA) continue; // ブランチ削除

    // ベースが無い(最初の push)ときは、見送らず、履歴の最初からを検査する。
    const start = remoteSha && remoteSha !== ZERO_SHA ? remoteSha : baseFor(localSha);

    // git の実行に失敗したら、検査できていないので、止める(例外はまとめて下で扱う)。
    const diff = checkEachCommit(start, localSha);
    for (const b of [...diff.blocks, ...checkCommits(start, localSha)]) blocks.push(`[${remoteRef}] ${b}`);
    warns.push(...diff.warns);
  }
}
catch {
  blocks.push("検査を完了できませんでした(git の実行に失敗。リモートの SHA がローカルに無い場合などに起きます)");
}

report(
  "push を中止しました。機密情報・混入させるべきでないファイル・意図しない作者の可能性がある内容を検出しました。",
  blocks,
  warns,
  "内容を確認し、該当箇所を除去・修正してから push してください。",
);
