import { execFileSync } from "node:child_process";
import {
  checkAuthors,
  checkEntries,
  checkSensitiveFilenames,
  checkUnexpectedPaths,
  parseAddedLines,
  textToEntries,
} from "./pr-secrets-check.ts";
import type { CheckResult, CommitAuthor } from "./pr-secrets-check.ts";
import { readLocalDenylist } from "./local-denylist.ts";

export const ZERO_SHA = "0000000000000000000000000000000000000000";
// 空の木。基準になるブランチが無いとき(最初の push)は、履歴の最初からを検査範囲にする。
export const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

// 検査ロジック自身のテスト(ダミーの秘密情報パターンを含む)は、内容の検査から除く。
// ファイル名と変更範囲の検査は、全ファイルが対象のまま。
const EXCLUDE_TESTS = [":(exclude,glob)**/*.test.*", ":(exclude,glob)**/*.spec.*"];

/** git を実行する。失敗したら例外を投げる(検査できなかったものを、成功として扱わない)。 */
export function git(args: string[]): string {
  return execFileSync("git", ["-c", "core.quotePath=false", ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
    maxBuffer: 256 * 1024 * 1024,
  });
}

export function tryGit(args: string[]): string {
  try {
    return git(args);
  }
  catch {
    return "";
  }
}

/**
 * diffArgs(例: ["--cached"] や ["abc", "def"])の差分を検査する。追加行だけを見る。
 * git の実行に失敗したら例外を投げる。
 */
export function checkDiff(diffArgs: string[]): CheckResult {
  const files = git(["diff", "--name-only", ...diffArgs]).split("\n").filter(Boolean);
  const diff = git(["diff", "-U0", ...diffArgs, "--", ".", ...EXCLUDE_TESTS]);
  const { blocks, warns } = checkEntries(parseAddedLines(diff), readLocalDenylist());
  return {
    blocks: [...checkSensitiveFilenames(files), ...checkUnexpectedPaths(files), ...blocks],
    warns,
  };
}

/** 範囲 start..end の、コミットメッセージと作者・コミッターを検査する。start が null なら、end までの全コミット。 */
export function checkCommits(start: string | null, end: string): string[] {
  const out = git(["log", "--format=%H%x1f%ae%x1f%ce%x1f%B%x1e", start ? `${start}..${end}` : end]);
  const denylist = readLocalDenylist();
  const blocks: string[] = [];
  const authors: CommitAuthor[] = [];
  for (const record of out.split("\x1e").map((r) => r.trim()).filter(Boolean)) {
    const [sha = "", authorEmail = "", committerEmail = "", body = ""] = record.split("\x1f");
    const short = sha.slice(0, 7);
    authors.push({ sha: short, authorEmail, committerEmail });
    blocks.push(...checkEntries(textToEntries(body, `message:${short}`), denylist, { message: true }).blocks);
  }
  return [...checkAuthors(authors), ...blocks];
}

/**
 * 検査すべき範囲の開始点。新規ブランチなら、リモートの main(origin/main)との共通の祖先。
 * origin/main が無い(最初の push)ときは null を返し、履歴の最初からを検査する。
 * ローカルの main は、リモートに何があるかの根拠にならないので、基準にしない。
 */
export function baseFor(localSha: string): string | null {
  const merge = tryGit(["merge-base", "origin/main", localSha]).trim();
  return merge || null;
}

/**
 * 範囲内の各コミットの差分を、コミットごとに検査する(あとで消した値も、途中のコミットから見つける)。
 * start が null なら、end までの全コミット。
 */
export function checkEachCommit(start: string | null, end: string): CheckResult {
  const shas = git(["rev-list", "--reverse", start ? `${start}..${end}` : end]).split("\n").filter(Boolean);
  const blocks: string[] = [];
  const warns: string[] = [];
  for (const sha of shas) {
    const parents = git(["rev-list", "--parents", "-n", "1", sha]).trim().split(" ").slice(1);
    const first = parents[0];
    const result = checkDiff(first ? [first, sha] : [EMPTY_TREE, sha]);
    const short = sha.slice(0, 7);
    blocks.push(...result.blocks.map((b) => `${b} (コミット ${short})`));
    warns.push(...result.warns.map((w) => `${w} (コミット ${short})`));
  }
  return { blocks, warns };
}

export function report(title: string, blocks: string[], warns: string[], hint: string): void {
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
