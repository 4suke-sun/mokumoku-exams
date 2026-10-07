import { execFileSync } from "node:child_process";
import {
  checkAuthors,
  checkEntries,
  checkSensitiveFilenames,
  checkUnexpectedPaths,
  parseAddedLines,
  textToEntries,
} from "./pr-secrets-check.mjs";
import { readLocalDenylist } from "./local-denylist.mjs";

export const ZERO_SHA = "0000000000000000000000000000000000000000";

// テストファイルは、検査ロジック自身のフィクスチャを誤検出するため、内容の検査からは除く。
// ファイル名と変更範囲の検査は、全ファイルが対象のまま。
const EXCLUDE_TESTS = [":(exclude,glob)**/*.test.*", ":(exclude,glob)**/*.spec.*"];

export function git(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
}

export function tryGit(args) {
  try {
    return git(args);
  }
  catch {
    return "";
  }
}

/** diffArgs(例: ["--cached"] や ["abc..def"])の差分を検査する。追加行だけを見る。 */
export function checkDiff(diffArgs) {
  const files = tryGit(["diff", "--name-only", ...diffArgs]).split("\n").filter(Boolean);
  const diff = tryGit(["diff", "-U0", ...diffArgs, "--", ".", ...EXCLUDE_TESTS]);
  const { blocks, warns } = checkEntries(parseAddedLines(diff), readLocalDenylist());
  return {
    blocks: [...checkSensitiveFilenames(files), ...checkUnexpectedPaths(files), ...blocks],
    warns,
  };
}

/** 範囲 start..end の、コミットメッセージと作者を検査する。 */
export function checkCommits(start, end) {
  const out = tryGit(["log", "--format=%H%x1f%ae%x1f%B%x1e", `${start}..${end}`]);
  const denylist = readLocalDenylist();
  const blocks = [];
  const authors = [];
  for (const record of out.split("\x1e").map((r) => r.trim()).filter(Boolean)) {
    const [sha, email, body = ""] = record.split("\x1f");
    const short = sha.slice(0, 7);
    authors.push({ sha: short, email });
    blocks.push(...checkEntries(textToEntries(body, `message:${short}`), denylist, { message: true }).blocks);
  }
  return [...checkAuthors(authors), ...blocks];
}

/** 検査すべき範囲の開始点。新規ブランチなら main からの全体を見る。 */
export function baseFor(localSha) {
  for (const ref of ["origin/main", "main"]) {
    const merge = tryGit(["merge-base", ref, localSha]).trim();
    if (merge) return merge;
  }
  return null;
}

export function report(title, blocks, warns, hint) {
  if (warns.length > 0) {
    process.stderr.write("警告(止めてはいません。内容を確認してください):\n");
    for (const w of [...new Set(warns)].slice(0, 20)) process.stderr.write(`- ${w}\n`);
  }
  if (blocks.length > 0) {
    process.stderr.write(`${title}\n`);
    for (const b of [...new Set(blocks)].slice(0, 20)) process.stderr.write(`- ${b}\n`);
    process.stderr.write(`${hint}\n`);
    process.exitCode = 1;
  }
}
