#!/usr/bin/env node
/**
 * 使い方ページのデータ(data/help.json)の検査。
 *   node scripts/validate-help-data.ts [データのフォルダ(既定: data)]
 * 失敗したら終了コード 1。引数が不正なら 2。報告は、場所と種類だけ(入力の値は出さない)。
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NAV_ITEMS } from "../packages/app/src/lib/nav.ts";
import { report } from "./lib/git-check.ts";
import { HELP_FILE, validateHelpData } from "./lib/help-data/validate.ts";

const args = process.argv.slice(2);
if (args.length > 1) {
  process.stderr.write("使い方: node scripts/validate-help-data.ts [データのフォルダ]\n");
  process.exit(2);
}
const dir = args[0] ?? "data";

const blocks: string[] = [];
try {
  const helpPath = join(dir, HELP_FILE);
  let help: unknown = null;
  if (existsSync(helpPath)) {
    try {
      help = JSON.parse(readFileSync(helpPath, "utf8"));
    } catch {
      // JSON の解析エラーは、入力の一部を含むことがあるので、固定の文言にする
      blocks.push(`${HELP_FILE}: JSON として読めません`);
    }
  }

  if (blocks.length === 0) {
    const exams = JSON.parse(readFileSync(join(dir, "exams.json"), "utf8")) as {
      exams?: { examCode?: string; status?: string }[];
    };
    const examCodes = (exams.exams ?? [])
      .filter((e) => e.status === "published" && typeof e.examCode === "string")
      .map((e) => e.examCode as string);
    const routes = NAV_ITEMS.map((item) => item.href);
    blocks.push(...validateHelpData(help, { routes, examCodes }));
  }
} catch {
  blocks.push(`${dir} を検査できませんでした(フォルダの読み込みに失敗)`);
}

report("使い方ページのデータの検査に失敗しました。", blocks, [], "docs/data-spec.md の仕様に沿って直してください。");
