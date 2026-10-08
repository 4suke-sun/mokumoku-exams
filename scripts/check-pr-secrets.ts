#!/usr/bin/env node
/**
 * PR・Issue の下書きファイルを検査する。
 *   node scripts/check-pr-secrets.ts <下書きファイル>...
 * 下書き(タイトルと本文)の全行を対象にする。投稿は、検査と人の確認を経た同じファイルから行う。
 */
import { readFileSync } from "node:fs";
import { report } from "./lib/git-check.ts";
import { checkEntries, textToEntries } from "./lib/pr-secrets-check.ts";
import { readLocalDenylist } from "./lib/local-denylist.ts";

const files = process.argv.slice(2);
if (files.length === 0) {
  process.stderr.write("使い方: node scripts/check-pr-secrets.ts <下書きファイル>...\n");
  process.exit(2);
}

const denylist = readLocalDenylist();
const blocks: string[] = [];
const warns: string[] = [];
for (const file of files) {
  const result = checkEntries(textToEntries(readFileSync(file, "utf8"), file), denylist, { message: true });
  blocks.push(...result.blocks);
  warns.push(...result.warns);
}

report("下書きに、書いてはいけない内容の可能性があります。投稿しないでください。", blocks, warns, "下書きを直して、検査をやり直してください。");
