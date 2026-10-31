#!/usr/bin/env node
/**
 * 体系ノートのデータ(notebook.<コード>.json)の検査。資格マスタの形の検査は、
 * scripts/validate-exam-data.ts が先に行う(ここでは、照合に使う分野のコードだけを読む)。
 *   node scripts/validate-notebook-data.ts [データのフォルダ(既定: data)]
 * 失敗したら終了コード 1。引数が不正なら 2。報告は、場所と種類だけ(入力の値は出さない)。
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DataFile } from "@mokumoku-exams/data-schema/exam-data/validate";
import { validateNotebookData } from "@mokumoku-exams/data-schema/notebook-data/validate";
import { report } from "./lib/git-check.ts";

const args = process.argv.slice(2);
if (args.length > 1) {
  process.stderr.write("使い方: node scripts/validate-notebook-data.ts [データのフォルダ]\n");
  process.exit(2);
}
const dir = args[0] ?? "data";

const blocks: string[] = [];
try {
  const unreadable: string[] = [];
  const read = (name: string): unknown => {
    try {
      return JSON.parse(readFileSync(join(dir, name), "utf8"));
    } catch {
      // JSON の解析エラーは、入力の一部を含むことがあるので、固定の文言にする
      unreadable.push(`${name}: JSON として読めません`);
      return undefined;
    }
  };

  const notebookFiles: DataFile[] = readdirSync(dir)
    .filter((n) => n.startsWith("notebook.") && n.endsWith(".json"))
    .map((name) => ({ name, data: read(name) }));

  // 公開中の資格ごとに、資格マスタの分野のコードを集める
  const exams = (
    read("exams.json") as
      | { exams?: { examCode?: unknown; status?: unknown; domains?: { code?: unknown }[] }[] }
      | undefined
  )?.exams;
  const domains = new Map<string, Set<string>>();
  for (const exam of Array.isArray(exams) ? exams : []) {
    if (exam.status !== "published" || typeof exam.examCode !== "string") continue;
    const codes = (Array.isArray(exam.domains) ? exam.domains : [])
      .map((d) => d.code)
      .filter((c): c is string => typeof c === "string");
    domains.set(exam.examCode, new Set(codes));
  }

  blocks.push(...unreadable);
  if (unreadable.length === 0) blocks.push(...validateNotebookData(notebookFiles, { domains }));
} catch {
  blocks.push(`${dir} を検査できませんでした(フォルダの読み込みに失敗)`);
}

report("体系ノートのデータの検査に失敗しました。", blocks, [], "docs/data-spec.md の仕様に沿って直してください。");
