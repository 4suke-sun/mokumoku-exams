#!/usr/bin/env node
/**
 * data/release-notes.json の、指定した版のエントリから、GitHub のリリース本文(Markdown)を標準出力に出す。
 *   node scripts/release-notes-body.ts vX.Y.Z
 * エントリが無い・構造が不正なときは、終了コード 1。
 */
import { readFileSync } from "node:fs";
import type { Release } from "./lib/release-notes-check.ts";
import { formatRelease, validateReleaseNotes } from "./lib/release-notes-check.ts";

const version = process.argv[2];
if (!version || process.argv.length !== 3) {
  process.stderr.write("使い方: node scripts/release-notes-body.ts vX.Y.Z\n");
  process.exit(2);
}

try {
  const data: unknown = JSON.parse(readFileSync("data/release-notes.json", "utf8"));
  if (validateReleaseNotes(data).length > 0) throw new Error("release-notes.json の構造が不正です");
  const release = (data as { releases: Release[] }).releases.find((r) => r.version === version);
  if (!release) throw new Error("対応するエントリがありません");
  process.stdout.write(formatRelease(release));
} catch (error) {
  process.stderr.write(`リリース本文を作れませんでした: ${error instanceof Error ? error.message : "不明なエラー"}\n`);
  process.exit(1);
}
