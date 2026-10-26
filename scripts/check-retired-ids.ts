#!/usr/bin/env node
/**
 * 削除した問題 ID が、資格マスタの retiredQuestionIds に入っているかの検査(CI で回す)。
 *   node scripts/check-retired-ids.ts [基準の ref]   既定の基準は origin/main
 * 基準の data/questions.*.json と、作業ツリーのものを比べる(非公開のファイルの分は、次の行)。失敗したら終了コード 1。
 * 非公開の問題(data/unpublished.*.json)の ID は、同じ資格の公開の問題と合わせて数える(公開と非公開のあいだの移動は、削除ではない)。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { report } from "./lib/git-check.ts";
import { buildSnapshot, checkRemovedIds } from "./lib/retired-ids-check.ts";

const DATA = "data";
const base = process.argv[2] ?? "origin/main";
// 問題データは 1MB を超えうる。既定の出力の上限では、git show の出力が切れて失敗する
const git = (args: string[]) =>
  execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 256 * 1024 * 1024 });
/** 公開のファイル(questions)と、非公開のファイル(unpublished。entries[].question)の、どちらの形からも問題 ID を取り出す */
const idsOf = (text: string): string[] => {
  const file = JSON.parse(text) as {
    questions?: { questionId?: unknown }[];
    entries?: { question?: { questionId?: unknown } }[];
  };
  const questions = [...(file.questions ?? []), ...(file.entries ?? []).map((e) => e.question ?? {})];
  return questions.flatMap((q) => (typeof q.questionId === "string" ? [q.questionId] : []));
};
const TRACKED = /^(questions|unpublished)\..+\.json$/;

try {
  git(["rev-parse", "--verify", `${base}^{commit}`]);
} catch {
  process.stderr.write(`基準の ref(${base})が見つかりません。取得してから実行してください。\n`);
  process.exit(2);
}

const baseFiles = git(["ls-tree", "--name-only", base, `${DATA}/`])
  .split("\n")
  .map((p) => p.replace(`${DATA}/`, ""))
  .filter((f) => TRACKED.test(f));
const baseSnapshot = buildSnapshot(
  baseFiles.map((name) => ({ name, ids: idsOf(git(["show", `${base}:${DATA}/${name}`])) })),
);
const currentSnapshot = buildSnapshot(
  readdirSync(DATA)
    .filter((f) => TRACKED.test(f))
    .map((name) => ({ name, ids: idsOf(readFileSync(join(DATA, name), "utf8")) })),
);
const exams = existsSync(join(DATA, "exams.json"))
  ? (JSON.parse(readFileSync(join(DATA, "exams.json"), "utf8")) as {
      exams: { examCode: string; retiredQuestionIds?: string[] }[];
    })
  : { exams: [] };
const retired = Object.fromEntries(exams.exams.map((e) => [e.examCode, e.retiredQuestionIds ?? []]));
const codeOfFile = (file: string) => {
  const slug = /^questions\.(.+)\.json$/.exec(file)?.[1];
  return exams.exams.find((e) => e.examCode.toLowerCase() === slug)?.examCode ?? null;
};

report(
  "削除した問題 ID の検査に失敗しました。",
  checkRemovedIds(baseSnapshot, currentSnapshot, retired, codeOfFile),
  [],
  "削除した問題の ID を、資格マスタ(data/exams.json)のその資格の retiredQuestionIds に足してください(docs/data-spec.md の 7)。",
);
