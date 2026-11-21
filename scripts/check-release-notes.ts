#!/usr/bin/env node
/**
 * data/release-notes.json の検証と、タグとの 1:1 の対応の検査。
 *   node scripts/check-release-notes.ts              構造・本文の検査と、既存のタグとの対応の検査
 *   node scripts/check-release-notes.ts --tag vX.Y.Z  そのタグに対応するエントリがあることの検査(タグを切るとき)
 * どちらの形でも、書き方の基準のうち機械で守れるもの(長さ、利用者向けの項目の内部の語)を検査する。
 * 失敗したら終了コード 1。
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { report } from "./lib/git-check.ts";
import { readLocalDenylist } from "./lib/local-denylist.ts";
import { checkEntries, textToEntries } from "./lib/pr-secrets-check.ts";
import type { Release } from "./lib/release-notes-check.ts";
import {
  checkTagCorrespondence,
  checkTagHasEntry,
  checkWritingStyle,
  validateReleaseNotes,
} from "./lib/release-notes-check.ts";

const FILE = "data/release-notes.json";
const args = process.argv.slice(2);
const blocks: string[] = [];
const warns: string[] = [];

// 引数は、無し、または `--tag <vX.Y.Z>` だけ。綴りの誤りなどは、検査を行わずに成功させないよう、失敗にする。
const validArgs = args.length === 0 || (args.length === 2 && args[0] === "--tag" && Boolean(args[1]));
if (!validArgs) {
  process.stderr.write("使い方: node scripts/check-release-notes.ts [--tag vX.Y.Z]\n");
  process.exit(2);
}

try {
  const text = readFileSync(FILE, "utf8");
  const data: unknown = JSON.parse(text);
  const structure = validateReleaseNotes(data);
  blocks.push(...structure);

  if (structure.length === 0) {
    const releases = (data as { releases: Release[] }).releases;
    blocks.push(...checkWritingStyle(releases));
    const tag = args[1];
    if (args[0] === "--tag" && tag) {
      blocks.push(...checkTagHasEntry(releases, tag));
    } else {
      const tags = execFileSync("git", ["tag", "--list", "v*"], { encoding: "utf8" }).split("\n").filter(Boolean);
      blocks.push(...checkTagCorrespondence(releases, tags));
    }
    // 利用者にも見える文面なので、環境固有の値や個人情報が無いかも検査する。
    const content = checkEntries(textToEntries(text, FILE), readLocalDenylist());
    blocks.push(...content.blocks);
    warns.push(...content.warns);
  }
} catch {
  blocks.push(`${FILE} を検査できませんでした(読み込み・JSON の解析・git の実行に失敗)`);
}

report(
  "リリースノートの検査に失敗しました。",
  blocks,
  warns,
  "data/release-notes.json を直してください(新しい版を先頭に、版・日付・タイトル・項目を書きます。書き方は CONTRIBUTING.md の「リリースノートの書き方」)。",
);
