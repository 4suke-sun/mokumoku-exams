#!/usr/bin/env node
/**
 * Vitest のカバレッジの集計(json-summary の coverage-summary.json)を、Markdown の表にして標準出力に出す。
 * CI で、ジョブのまとめ($GITHUB_STEP_SUMMARY)に足すために使う。値を見せるだけで、しきい値では止めない。
 *   node scripts/coverage-summary.ts <coverage-summary.json>
 * 読めなければ終了コード 1。引数が不正なら 2。
 */
import { readFileSync } from "node:fs";
import { coverageTable, isSummary } from "./lib/coverage-summary.ts";

const args = process.argv.slice(2);
if (args.length !== 1 || args[0] === undefined) {
  process.stderr.write("使い方: node scripts/coverage-summary.ts <coverage-summary.json>\n");
  process.exit(2);
}
let summary: unknown;
try {
  summary = JSON.parse(readFileSync(args[0], "utf8"));
} catch {
  // 解析エラーの文言は、入力の一部を含むことがあるので、固定の文言にする
  process.stderr.write("カバレッジの集計を読めません\n");
  process.exit(1);
}
if (!isSummary(summary)) {
  process.stderr.write("カバレッジの集計の形が違います\n");
  process.exit(1);
}
process.stdout.write(coverageTable(summary));
