#!/usr/bin/env node
/**
 * push 前のフック本体(.githooks/pre-push から呼ばれる)。標準入力は
 * `<ローカルref> <ローカルSHA> <リモートref> <リモートSHA>` の行。
 * 範囲内の全コミットの、追加行・ファイル名・変更範囲・メッセージ・作者を検査する。
 * 失敗したら push を止める(このスクリプト自身のエラーでも素通りさせない)。
 */
import { readFileSync } from "node:fs";
import { ZERO_SHA, baseFor, checkCommits, checkDiff, report } from "./lib/git-check.mjs";

const lines = readFileSync(0, "utf8").split("\n").map((l) => l.trim()).filter(Boolean);
const blocks = [];
const warns = [];

for (const line of lines) {
  const [, localSha, remoteRef, remoteSha] = line.split(/\s+/);
  if (!localSha || localSha === ZERO_SHA) continue; // ブランチ削除

  const start = remoteSha !== ZERO_SHA ? remoteSha : baseFor(localSha);
  if (!start) continue; // ベースが分からなければ、この参照は見送る

  const diff = checkDiff([`${start}..${localSha}`]);
  for (const b of [...diff.blocks, ...checkCommits(start, localSha)]) blocks.push(`[${remoteRef}] ${b}`);
  warns.push(...diff.warns);
}

report(
  "push を中止しました。機密情報・混入させるべきでないファイル・意図しない作者の可能性がある内容を検出しました。",
  blocks,
  warns,
  "内容を確認し、該当箇所を除去・修正してから push してください。",
);
