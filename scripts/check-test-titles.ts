#!/usr/bin/env node
/**
 * テストの題(it / test)の形の検査。題は「前提条件_期待結果」(CONTRIBUTING.md の「テスト」)。
 *   node scripts/check-test-titles.ts           基準にない違反と、基準から消し忘れた題を止める
 *   node scripts/check-test-titles.ts --write   直した題を基準から消す(基準に足すことはしない)
 * 失敗したら終了コード 1。引数が不正なら 2。
 */
import { readFileSync, writeFileSync } from "node:fs";
import { git, report } from "./lib/git-check.ts";
import { type Baseline, checkTestTitles } from "./lib/test-title-check.ts";

const BASELINE_PATH = "scripts/test-title-baseline.json";
const args = process.argv.slice(2);
if (args.length > 1 || (args[0] !== undefined && args[0] !== "--write")) {
  process.stderr.write("使い方: node scripts/check-test-titles.ts [--write]\n");
  process.exit(2);
}

const blocks: string[] = [];
try {
  const paths = git(["ls-files", "--", "*.test.ts", "*.test.tsx", "*.spec.ts"])
    .split("\n")
    .filter((p) => p !== "");
  const files = paths.map((file) => ({ file, text: readFileSync(file, "utf8") }));
  const baseline: Baseline = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  const { violations, fixed, shrunk } = checkTestTitles(files, baseline);
  blocks.push(...violations);
  if (args[0] === "--write") {
    const sorted = Object.fromEntries(Object.entries(shrunk).sort(([a], [b]) => a.localeCompare(b)));
    writeFileSync(BASELINE_PATH, `${JSON.stringify(sorted, null, 2)}\n`);
  } else {
    blocks.push(...fixed.map((f) => `${f}(npm run check:test-titles -- --write で基準を更新する)`));
  }
} catch {
  blocks.push("テストの題を検査できませんでした(読み込みに失敗)");
}

report(
  "テストの題の検査に失敗しました。",
  blocks,
  [],
  "題を「前提条件_期待結果」の形にしてください(CONTRIBUTING.md の「テスト」)。",
);
