#!/usr/bin/env node
/**
 * 画面の書き方の型の検査(docs/app/design-tone.md の「型を除く決まり」)。
 *   node scripts/check-ui-patterns.ts
 * アプリ(packages/app/src)の画面の部品と CSS を走査し、規則(scripts/lib/ui-patterns-check.ts)に当たる箇所を、
 * 場所と種類だけで報告して失敗する(終了コード 1)。意図して残す箇所は、同じファイルの許可の一覧に、理由つきで置く。
 */
import { readFileSync } from "node:fs";
import { git, report } from "./lib/git-check.ts";
import { checkUiPatterns, isTarget } from "./lib/ui-patterns-check.ts";

const blocks: string[] = [];
try {
  // 追跡しているファイルと、まだ追跡していない新しいファイル(.gitignore のものは除く)
  const files = git(["ls-files", "--cached", "--others", "--exclude-standard", "--", "packages/app/src"])
    .split("\n")
    .filter((f) => f !== "" && isTarget(f));
  if (files.length === 0) blocks.push("packages/app/src: 検査の対象のファイルが見つからない");
  blocks.push(...checkUiPatterns(files.map((file) => ({ file, text: readFileSync(file, "utf8") }))).errors);
} catch {
  blocks.push("画面の書き方の型を検査できませんでした(読み込みに失敗)");
}

report(
  "画面の書き方の型の検査に失敗しました。",
  blocks,
  [],
  "決まり(docs/app/design-tone.md の「型を除く決まり」)に合わせて直すか、意図して残すものは scripts/lib/ui-patterns-check.ts の許可の一覧に、理由つきで足してください。",
);
