#!/usr/bin/env node
/**
 * commit 前のフック本体。
 *   引数なし        : ステージした差分(追加行・ファイル名・変更範囲)を検査する(pre-commit から)
 *   --message <file>: コミットメッセージを検査する(commit-msg から)
 * 失敗したらコミットを止める(このスクリプト自身のエラーでも素通りさせない)。
 */
import { readFileSync } from "node:fs";
import { checkDiff, report } from "./lib/git-check.mjs";
import { checkEntries, textToEntries } from "./lib/pr-secrets-check.mjs";
import { readLocalDenylist } from "./lib/local-denylist.mjs";

const args = process.argv.slice(2);

if (args[0] === "--message") {
  const text = readFileSync(args[1], "utf8")
    .split("\n")
    .filter((l) => !l.startsWith("#"))
    .join("\n");
  const { blocks, warns } = checkEntries(textToEntries(text, "message"), readLocalDenylist(), { message: true });
  report("コミットを中止しました。コミットメッセージに、書いてはいけない内容の可能性があります。", blocks, warns, "メッセージを直してください。");
}
else {
  const { blocks, warns } = checkDiff(["--cached"]);
  report(
    "コミットを中止しました。機密情報・環境固有の値・混入させるべきでないファイルの可能性がある内容を検出しました。",
    blocks,
    warns,
    "実値は .env に置き、コードやドキュメントには <プロファイル名> のようなプレースホルダーを書いてください。",
  );
}
