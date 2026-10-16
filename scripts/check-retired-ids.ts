#!/usr/bin/env node
/**
 * 削除した問題 ID が、資格マスタの retiredQuestionIds に入っているかの検査(CI で回す)。
 *   node scripts/check-retired-ids.ts [基準の ref]   既定の基準は origin/main
 * 基準の data/questions.*.json と、作業ツリーのものを比べる。失敗したら終了コード 1。
 */
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { report } from "./lib/git-check.ts";
import { checkRemovedIds, type QuestionsSnapshot } from "./lib/retired-ids-check.ts";

const DATA = "data";
const base = process.argv[2] ?? "origin/main";
const git = (args: string[]) => execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const idsOf = (text: string): string[] =>
  ((JSON.parse(text) as { questions?: { questionId?: unknown }[] }).questions ?? []).flatMap((q) =>
    typeof q.questionId === "string" ? [q.questionId] : [],
  );

try {
  git(["rev-parse", "--verify", `${base}^{commit}`]);
} catch {
  process.stderr.write(`基準の ref(${base})が見つかりません。取得してから実行してください。\n`);
  process.exit(2);
}

const baseFiles = git(["ls-tree", "--name-only", base, `${DATA}/`])
  .split("\n")
  .map((p) => p.replace(`${DATA}/`, ""))
  .filter((f) => /^questions\..+\.json$/.test(f));
const baseSnapshot: QuestionsSnapshot = Object.fromEntries(
  baseFiles.map((f) => [f, idsOf(git(["show", `${base}:${DATA}/${f}`]))]),
);
const currentSnapshot: QuestionsSnapshot = Object.fromEntries(
  readdirSync(DATA)
    .filter((f) => /^questions\..+\.json$/.test(f))
    .map((f) => [f, idsOf(readFileSync(join(DATA, f), "utf8"))]),
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
