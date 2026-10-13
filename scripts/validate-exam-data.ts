#!/usr/bin/env node
/**
 * 資格マスタ(exams.json)と問題データ(questions.<コード>.json)の検査。
 *   node scripts/validate-exam-data.ts [データのフォルダ(既定: data)]
 * 失敗したら終了コード 1。引数が不正なら 2。報告は、場所と種類だけ(入力の値は出さない)。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DataFile } from "@mokumoku-exams/data-schema/exam-data/validate";
import { validateDataSet } from "@mokumoku-exams/data-schema/exam-data/validate";
import { report } from "./lib/git-check.ts";

const args = process.argv.slice(2);
if (args.length > 1) {
  process.stderr.write("使い方: node scripts/validate-exam-data.ts [データのフォルダ]\n");
  process.exit(2);
}
const dir = args[0] ?? "data";

const blocks: string[] = [];
try {
  const readJson = (name: string): unknown => JSON.parse(readFileSync(join(dir, name), "utf8"));
  const unreadable: string[] = [];
  const read = (name: string): unknown => {
    try {
      return readJson(name);
    } catch {
      // JSON の解析エラーは、入力の一部を含むことがあるので、固定の文言にする
      unreadable.push(`${name}: JSON として読めません`);
      return undefined;
    }
  };

  const examsPath = join(dir, "exams.json");
  const exams = existsSync(examsPath) ? read("exams.json") : null;
  const questionFiles: DataFile[] = readdirSync(dir)
    .filter((n) => n.startsWith("questions.") && n.endsWith(".json"))
    .map((name) => ({ name, data: read(name) }));

  blocks.push(...unreadable);
  const vendorsPath = join(dir, "vendors.json");
  const vendors = existsSync(vendorsPath) ? read("vendors.json") : null;
  if (unreadable.length === 0) blocks.push(...validateDataSet(exams, questionFiles, vendors));
} catch {
  blocks.push(`${dir} を検査できませんでした(フォルダの読み込みに失敗)`);
}

report("問題データの検査に失敗しました。", blocks, [], "docs/data-spec.md の仕様に沿って直してください。");
