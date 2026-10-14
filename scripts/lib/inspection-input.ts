import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { git } from "./git-check.ts";
import { findDenylistPaths } from "./local-denylist.ts";

export const INSPECT_DIR = ".drafts/inspect";

export type InspectionMode = { kind: "cached" } | { kind: "range"; range: string } | { kind: "pr"; base: string };

const COMMIT_FORMAT = "=== コミット %h%n作者: %ae%nコミッター: %ce%n%n%B";

/**
 * 検査役が読むファイルを、INSPECT_DIR に書き出す。検査役は Bash を持たず、Read / Grep / Glob だけで読むので、
 * 差分・ログ・ブランチ名・拒否リストの置き場は、メインのセッションがここに用意する。
 */
export function prepareInspection(mode: InspectionMode, root: string): string[] {
  const dir = join(root, INSPECT_DIR);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  const diffArgs = {
    cached: ["diff", "--cached"],
    range: ["log", "-p", `--format=${COMMIT_FORMAT}`, mode.kind === "range" ? mode.range : ""],
    pr: ["diff", mode.kind === "pr" ? `${mode.base}...HEAD` : ""],
  }[mode.kind];
  const names = {
    cached: ["diff", "--cached", "--name-status"],
    range: ["log", "--name-status", `--format=${COMMIT_FORMAT}`, mode.kind === "range" ? mode.range : ""],
    pr: ["diff", "--name-status", mode.kind === "pr" ? `${mode.base}...HEAD` : ""],
  }[mode.kind];
  const commits =
    mode.kind === "range"
      ? git(["log", `--format=${COMMIT_FORMAT}`, mode.range])
      : mode.kind === "pr"
        ? git(["log", `--format=${COMMIT_FORMAT}`, `${mode.base}..HEAD`])
        : `作者(これから作るコミット): ${git(["config", "user.email"]).trim()}\n`;
  const denylist = findDenylistPaths();

  const files: Record<string, string> = {
    "diff.patch": git(diffArgs),
    "files.txt": git(names),
    "commits.txt": commits,
    "branch.txt": `${git(["branch", "--show-current"]).trim()}\n`,
    "denylist.txt":
      denylist.length > 0
        ? `${denylist.join("\n")}\n`
        : "なし(拒否リストが見つからない。照合できなかったと報告すること)\n",
  };
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return Object.keys(files);
}

export function cleanInspection(root: string): void {
  rmSync(join(root, INSPECT_DIR), { recursive: true, force: true });
}
