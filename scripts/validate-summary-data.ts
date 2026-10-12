#!/usr/bin/env node
/**
 * 要約カードのデータ(summary.<コード>.json)の検査。資格マスタと問題データの形の検査は、
 * scripts/validate-exam-data.ts が先に行う(ここでは、照合に使う問題 ID と正解だけを読む)。
 *   node scripts/validate-summary-data.ts [データのフォルダ(既定: data)]
 * 失敗したら終了コード 1。引数が不正なら 2。報告は、場所と種類だけ(入力の値は出さない)。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DataFile } from "./lib/exam-data/validate.ts";
import { report } from "./lib/git-check.ts";
import { type QuestionAnswers, validateSummaryData } from "./lib/summary-data/validate.ts";

const args = process.argv.slice(2);
if (args.length > 1) {
  process.stderr.write("使い方: node scripts/validate-summary-data.ts [データのフォルダ]\n");
  process.exit(2);
}
const dir = args[0] ?? "data";

type RawQuestion = { questionId?: unknown; questionType?: unknown; correctAnswers?: unknown };

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

  const summaryFiles: DataFile[] = readdirSync(dir)
    .filter((n) => n.startsWith("summary.") && n.endsWith(".json"))
    .map((name) => ({ name, data: read(name) }));

  // 公開中の資格ごとに、問題データにある問題と、択一・複数選択の正解のキーを集める
  const exams = (read("exams.json") as { exams?: { examCode?: unknown; status?: unknown }[] } | undefined)?.exams;
  const questions = new Map<string, QuestionAnswers>();
  for (const exam of Array.isArray(exams) ? exams : []) {
    if (exam.status !== "published" || typeof exam.examCode !== "string") continue;
    const name = `questions.${exam.examCode.toLowerCase()}.json`;
    if (!existsSync(join(dir, name))) continue;
    const list = (read(name) as { questions?: RawQuestion[] } | undefined)?.questions;
    const answers = new Map<string, readonly string[] | null>();
    for (const q of Array.isArray(list) ? list : []) {
      if (typeof q.questionId !== "string") continue;
      const keys = Array.isArray(q.correctAnswers)
        ? q.correctAnswers.filter((k): k is string => typeof k === "string")
        : null;
      answers.set(q.questionId, q.questionType === "free-text" ? null : keys);
    }
    questions.set(exam.examCode, answers);
  }

  blocks.push(...unreadable);
  if (unreadable.length === 0) blocks.push(...validateSummaryData(summaryFiles, { questions }));
} catch {
  blocks.push(`${dir} を検査できませんでした(フォルダの読み込みに失敗)`);
}

report("要約カードのデータの検査に失敗しました。", blocks, [], "docs/data-spec.md の仕様に沿って直してください。");
