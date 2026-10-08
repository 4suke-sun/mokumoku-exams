#!/usr/bin/env node
/**
 * docs/app/lessons/ の学びの記録の検査。
 *   node scripts/check-lessons.ts           書式・出来事を語る書き方・機密らしい内容・一覧の更新漏れの検査
 *   node scripts/check-lessons.ts --write   README の一覧を更新してから検査する
 * 失敗したら終了コード 1。引数が不正なら 2。
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { report } from "./lib/git-check.ts";
import { checkIndex, checkLessons, updateIndex } from "./lib/lessons-check.ts";
import { readLocalDenylist } from "./lib/local-denylist.ts";
import { checkEntries, textToEntries } from "./lib/pr-secrets-check.ts";

const DIR = "docs/app/lessons";
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] !== undefined && args[0] !== "--write")) {
  process.stderr.write("使い方: node scripts/check-lessons.ts [--write]\n");
  process.exit(2);
}

const blocks: string[] = [];
const warns: string[] = [];

try {
  const names = readdirSync(DIR)
    .filter((n) => n.endsWith(".md") && n !== "README.md")
    .sort();
  const files = names.map((file) => ({ file, text: readFileSync(join(DIR, file), "utf8") }));
  const { lessons, errors } = checkLessons(files);
  blocks.push(...errors);

  const readmePath = join(DIR, "README.md");
  let readme = readFileSync(readmePath, "utf8");
  if (args[0] === "--write") {
    const updated = updateIndex(readme, lessons);
    if (updated !== null && updated !== readme) {
      writeFileSync(readmePath, updated);
      readme = updated;
    }
  }
  blocks.push(...checkIndex(readme, lessons));

  // 公開される文書なので、機密らしい内容も検査する。
  const denylist = readLocalDenylist();
  for (const f of [...files, { file: "README.md", text: readme }]) {
    const result = checkEntries(textToEntries(f.text, join(DIR, f.file)), denylist);
    blocks.push(...result.blocks);
    warns.push(...result.warns);
  }
} catch {
  blocks.push(`${DIR} を検査できませんでした(読み込みに失敗)`);
}

report("学びの記録の検査に失敗しました。", blocks, warns, "docs/app/lessons/README.md の書式に沿って直してください。");
