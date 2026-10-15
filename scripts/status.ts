#!/usr/bin/env node
/**
 * 作業の状態の表示(読み取りだけ。何も変更しない)。作業の開始と再開で実行する。
 *   node scripts/status.ts
 * 最新のタグ、開いたマイルストーンと未完了の Issue、開いた PR、未 push のコミット、
 * マージ済みで残ったブランチ、作業ツリーを表示する。GitHub の情報が取れないときは、git だけで取れる項目を表示し、
 * 取れなかった項目を「取得できなかった」と表示する(空の項目と区別する)。
 */
import { execFileSync } from "node:child_process";
import { git } from "./lib/git-check.ts";
import {
  excludeAtBase,
  type Fetched,
  formatStatus,
  parseMergedBranches,
  parseMilestones,
  parsePullRequests,
  parseUnpushed,
  parseWorktrees,
  withLocalOnly,
} from "./lib/status.ts";

const gh = (args: string[]): string =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 });

function attempt<T>(reason: string, fn: () => T): Fetched<T> {
  try {
    return { ok: true, value: fn() };
  } catch {
    return { ok: false, reason };
  }
}

const currentBranch = () => git(["branch", "--show-current"]).trim();

/** origin/main に含まれるブランチのうち、先頭が origin/main と同じもの(コミットのない新しいブランチ)を除く。 */
function mergedBranches(args: string[], exclude: string[]): string[] {
  const names = parseMergedBranches(git(args), exclude);
  const tips: Record<string, string> = {};
  for (const name of names) tips[name] = git(["rev-parse", name]).trim();
  return excludeAtBase(names, tips, git(["rev-parse", "origin/main"]).trim());
}

const GIT_FAILED = "git の実行に失敗";
const GH_FAILED = "gh が使えない、認証がない、または通信できない";

const report = {
  latestTag: attempt(
    GIT_FAILED,
    () => git(["tag", "--sort=-v:refname", "--list", "v*"]).split("\n")[0]?.trim() || null,
  ),
  milestones: attempt(GH_FAILED, () => {
    const open = gh(["api", "repos/{owner}/{repo}/milestones?state=open&per_page=100", "--jq", "[.[] | {title}]"]);
    const issues: Record<string, string> = {};
    for (const m of JSON.parse(open) as { title: string }[]) {
      issues[m.title] = gh([
        "issue",
        "list",
        "--milestone",
        m.title,
        "--state",
        "open",
        "--limit",
        "200",
        "--json",
        "number,title",
      ]);
    }
    return parseMilestones(open, issues);
  }),
  pullRequests: attempt(GH_FAILED, () =>
    parsePullRequests(gh(["pr", "list", "--state", "open", "--json", "number,title,headRefName,isDraft"])),
  ),
  unpushed: attempt(GIT_FAILED, () => {
    const refs = git(["for-each-ref", "--format=%(refname:short)|%(upstream:short)|%(upstream:track)", "refs/heads"]);
    let result = parseUnpushed(refs);
    for (const line of refs.split("\n")) {
      const [branch = "", upstream = ""] = line.split("|");
      if (branch === "" || upstream !== "") continue;
      result = withLocalOnly(result, branch, Number(git(["rev-list", "--count", branch, "--not", "--remotes"]).trim()));
    }
    return result;
  }),
  mergedLocal: attempt(GIT_FAILED, () =>
    mergedBranches(["branch", "--merged", "origin/main"], ["main", currentBranch()]),
  ),
  mergedRemote: attempt(GIT_FAILED, () =>
    mergedBranches(["branch", "-r", "--merged", "origin/main"], ["origin/main", "origin/HEAD"]),
  ),
  worktrees: attempt(GIT_FAILED, () => parseWorktrees(git(["worktree", "list", "--porcelain"]))),
};

process.stdout.write(formatStatus(report));
