#!/usr/bin/env node
/**
 * カリキュラムのデータ(curriculum.<コード>.json)の検査。資格マスタと問題データの形の検査は、
 * scripts/validate-exam-data.ts が先に行う(ここでは、照合に使う問題 ID だけを読む)。
 *   node scripts/validate-curriculum-data.ts [データのフォルダ(既定: data)]
 * 失敗したら終了コード 1。引数が不正なら 2。報告は、場所と種類だけ(入力の値は出さない)。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCurriculumData } from "./lib/curriculum-data/validate.ts";
import type { DataFile } from "./lib/exam-data/validate.ts";
import { report } from "./lib/git-check.ts";

const args = process.argv.slice(2);
if (args.length > 1) {
  process.stderr.write("使い方: node scripts/validate-curriculum-data.ts [データのフォルダ]\n");
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

  const curriculumFiles: DataFile[] = readdirSync(dir)
    .filter((n) => n.startsWith("curriculum.") && n.endsWith(".json"))
    .map((name) => ({ name, data: read(name) }));

  // 公開中の資格ごとに、問題データにある問題 ID を集める
  const exams = (read("exams.json") as { exams?: { examCode?: unknown; status?: unknown }[] } | undefined)?.exams;
  const questionIds = new Map<string, Set<string>>();
  for (const exam of Array.isArray(exams) ? exams : []) {
    if (exam.status !== "published" || typeof exam.examCode !== "string") continue;
    const name = `questions.${exam.examCode.toLowerCase()}.json`;
    if (!existsSync(join(dir, name))) continue;
    const questions = (read(name) as { questions?: { questionId?: unknown }[] } | undefined)?.questions;
    const ids = (Array.isArray(questions) ? questions : [])
      .map((q) => q.questionId)
      .filter((id): id is string => typeof id === "string");
    questionIds.set(exam.examCode, new Set(ids));
  }

  blocks.push(...unreadable);
  if (unreadable.length === 0) blocks.push(...validateCurriculumData(curriculumFiles, { questionIds }));
} catch {
  blocks.push(`${dir} を検査できませんでした(フォルダの読み込みに失敗)`);
}

report("カリキュラムのデータの検査に失敗しました。", blocks, [], "docs/data-spec.md の仕様に沿って直してください。");
