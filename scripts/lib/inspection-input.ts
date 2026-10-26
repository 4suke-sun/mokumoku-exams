import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "./git-check.ts";
import { coveredCommits } from "./inspection-covered.ts";
import { findDenylistPaths } from "./local-denylist.ts";

export const INSPECT_DIR = ".drafts/inspect";
export const STAMP_FILE = "stamp.txt";

export type InspectionMode = { kind: "cached" } | { kind: "range"; range: string } | { kind: "pr"; base: string };

const COMMIT_FORMAT = "=== コミット %h%n作者: %ae%nコミッター: %ce%n%n%B";
const OMITTED = "(すべてのコミットが検査済みのため、差分は省略した。covered.txt を参照)\n";

/** 台帳が読めないときは、省略せず、すべてのコミットの差分を出す。 */
function safeCovered(range: string, root: string): string[] {
  try {
    return coveredCommits(range, root);
  } catch {
    return [];
  }
}

/**
 * 検査役が読むファイルを、INSPECT_DIR に書き出す。検査役は Bash を持たず、Read / Grep / Glob だけで読むので、
 * 差分・ログ・ブランチ名・拒否リストの置き場は、メインのセッションがここに用意する。
 * 範囲(push・PR)では、commit のときに検査した差分(台帳にある)の本文は省き、covered.txt に挙げる。
 * コミットのメッセージと作者は、検査済みでも、毎回 commits.txt に出す。
 */
export function buildInspection(mode: InspectionMode, root: string): Record<string, string> {
  const range = mode.kind === "range" ? mode.range : mode.kind === "pr" ? `${mode.base}..HEAD` : null;
  // マージコミットの内容(競合の解消など)は、コミットごとの差分に出ないので、マージを含む範囲は台帳を使わず、すべて読む。
  const hasMerges = range !== null && git(["rev-list", "--merges", range]).trim() !== "";
  const covered = range && !hasMerges ? safeCovered(range, root) : [];

  let diff: string;
  let names: string;
  let commits: string;
  if (range) {
    if (covered.length === 0) {
      diff =
        mode.kind === "pr"
          ? git(["diff", `${mode.base}...HEAD`])
          : git(["log", "-p", "--cc", `--format=${COMMIT_FORMAT}`, range]); // --cc で、競合を解消したマージの内容も出す
    } else {
      const shas = git(["rev-list", "--reverse", "--no-merges", range])
        .split("\n")
        .filter((sha) => sha !== "" && !covered.includes(sha));
      diff = shas.map((sha) => git(["show", `--format=${COMMIT_FORMAT}`, "--patch", sha])).join("\n");
      if (diff.trim() === "") diff = OMITTED;
    }
    // 変更ファイルの一覧。PR は基準との正味の差分。push はコミットごとの一覧に、マージの内容を含む正味の差分を添える
    names =
      mode.kind === "pr"
        ? git(["diff", "--name-status", `${mode.base}...HEAD`])
        : `${git(["log", "--name-status", `--format=${COMMIT_FORMAT}`, range])}\n=== 範囲の正味の差分 ===\n${git(["diff", "--name-status", range])}`;
    commits = git(["log", `--format=${COMMIT_FORMAT}`, range]);
  } else {
    diff = git(["diff", "--cached"]);
    names = git(["diff", "--cached", "--name-status"]);
    commits = `作者(これから作るコミット): ${git(["config", "user.email"]).trim()}\n`;
  }
  const denylist = findDenylistPaths();

  const files: Record<string, string> = {
    "diff.patch": diff,
    "files.txt": names,
    "commits.txt": commits,
    "covered.txt":
      covered.length > 0
        ? `検査済みのため、diff.patch から差分を省いたコミット(メッセージと作者は commits.txt にある):\n${covered.map((sha) => sha.slice(0, 7)).join("\n")}\n`
        : "なし(すべてのコミットの差分を diff.patch に出している)\n",
    "branch.txt": `${git(["branch", "--show-current"]).trim()}\n`,
    "denylist.txt":
      denylist.length > 0
        ? `${denylist.join("\n")}\n`
        : "なし(拒否リストが見つからない。照合できなかったと報告すること)\n",
  };
  return files;
}

/** 入力全体のスタンプ。検査役の報告に書き写させ、検査した入力といまの入力が同じかを確かめるのに使う。 */
export function stampOf(files: Record<string, string>): string {
  const hash = createHash("sha256");
  for (const name of Object.keys(files).sort()) hash.update(`${name}\0${files[name]}\0`);
  return hash.digest("hex").slice(0, 16);
}

/** 入力を書き出し、スタンプを stamp.txt に添える。戻り値は書き出したファイル名とスタンプ。 */
export function prepareInspection(mode: InspectionMode, root: string): { names: string[]; stamp: string } {
  const files = buildInspection(mode, root);
  const dir = join(root, INSPECT_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  const stamp = stampOf(files);
  writeFileSync(join(dir, STAMP_FILE), `スタンプ: ${stamp}\nモード: ${JSON.stringify(mode)}\n`);
  return { names: [...Object.keys(files), STAMP_FILE], stamp };
}

export type VerifyResult = { ok: true } | { ok: false; reason: string };

/**
 * 検査役の報告のスタンプが、いまの入力と一致するかを確かめる。次のどれかなら、一致しない:
 * 入力のファイルが書き出しのあとに変わった・欠けた、いまの差分から作り直した入力が変わっている、報告のスタンプが違う。
 */
export function verifyInspection(reported: string, root: string): VerifyResult {
  let stamp: string;
  let mode: InspectionMode;
  try {
    const text = readFileSync(join(root, INSPECT_DIR, STAMP_FILE), "utf8");
    stamp = /^スタンプ: ([0-9a-f]+)$/m.exec(text)?.[1] ?? "";
    mode = JSON.parse(/^モード: (.+)$/m.exec(text)?.[1] ?? "") as InspectionMode;
    if (!stamp) throw new Error("no stamp");
  } catch {
    return { ok: false, reason: "入力のスタンプが読めません(入力が片づけられたか、書き出されていません)" };
  }
  if (reported !== stamp) return { ok: false, reason: "報告のスタンプが、入力のスタンプと違います" };
  try {
    const expected = buildInspection(mode, root);
    const onDisk: Record<string, string> = {};
    for (const name of Object.keys(expected)) onDisk[name] = readFileSync(join(root, INSPECT_DIR, name), "utf8");
    if (stampOf(onDisk) !== stamp)
      return { ok: false, reason: "入力のファイルが、書き出しのあとに変わったか欠けています" };
    if (stampOf(expected) !== stamp) return { ok: false, reason: "検査のあとに、差分が変わっています" };
  } catch {
    return { ok: false, reason: "入力のファイルが欠けているか、差分を作り直せませんでした" };
  }
  return { ok: true };
}

export function cleanInspection(root: string): void {
  rmSync(join(root, INSPECT_DIR), { recursive: true, force: true });
}
