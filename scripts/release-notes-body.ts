#!/usr/bin/env node
/**
 * data/release-notes.json の、指定した版のエントリから、GitHub のリリース本文(Markdown)を標準出力に出す。
 *   node scripts/release-notes-body.ts vX.Y.Z
 * エントリが無い・構造が不正なときは、終了コード 1。引数が不正なときは、終了コード 2。
 * エラーメッセージは固定の文言にする(JSON の解析エラーなどは、入力の一部を含むことがあるため、そのまま出さない)。
 */
import { readFileSync } from "node:fs";
import type { Release } from "./lib/release-notes-check.ts";
import { formatRelease, validateReleaseNotes } from "./lib/release-notes-check.ts";

const FILE = "data/release-notes.json";

function fail(message: string): never {
  process.stderr.write(`リリース本文を作れませんでした: ${message}\n`);
  process.exit(1);
}

const version = process.argv[2];
if (!version || process.argv.length !== 3) {
  process.stderr.write("使い方: node scripts/release-notes-body.ts vX.Y.Z\n");
  process.exit(2);
}

let text: string;
try {
  text = readFileSync(FILE, "utf8");
} catch {
  fail(`${FILE} を読み込めません`);
}

let data: unknown;
try {
  data = JSON.parse(text);
} catch {
  fail(`${FILE} を JSON として解析できません`);
}

if (validateReleaseNotes(data).length > 0)
  fail(`${FILE} の構造が不正です(npm run check:release-notes で確認してください)`);

const release = (data as { releases: Release[] }).releases.find((r) => r.version === version);
if (!release) fail("指定した版に対応するエントリがありません");

process.stdout.write(formatRelease(release));
