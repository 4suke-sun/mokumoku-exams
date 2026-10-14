#!/usr/bin/env node
/**
 * 版のリリースの手順。人の明示の指示があるときだけ実行する(スキル: .claude/skills/dev-release)。
 *   node scripts/release.ts <PR の番号> --check   マージの前の確認だけ(GitHub とファイルの内容は変えない。リモートの情報の取得 fetch で、ローカルの追跡の参照とタグは更新する)
 *   node scripts/release.ts <PR の番号>           マージ → リリースノートの確認 → タグ → Release → マイルストーン → ブランチの削除 → 確認の一覧
 * 再実行してよい。目的の状態にある段階は「済み」として次へ進み、失敗したら、どの段階まで終えたかを表示して止まる。
 * `--force` 系の push と、`main` への直接の push はしない。
 */
import { execFileSync } from "node:child_process";
import { git } from "./lib/git-check.ts";
import { parseCloses } from "./lib/pr-closes-check.ts";
import {
  canContinue,
  checkMergeable,
  checkReleaseEntry,
  formatReleaseTable,
  isSafeBranchName,
  isVersion,
  normalizeChecks,
  planBranch,
  planMilestone,
  planTag,
  type RollupItem,
  type StepResult,
} from "./lib/release-plan.ts";

const gh = (args: string[]): string =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 * 1024 * 1024 });
const tryGit = (args: string[]): string | null => {
  try {
    return git(args).trim();
  } catch {
    return null;
  }
};
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const args = process.argv.slice(2);
const prNumber = args[0] ?? "";
const checkOnly = args.includes("--check");
if (!/^\d+$/.test(prNumber) || args.length > 2 || args.some((a, i) => i > 0 && a !== "--check")) {
  process.stderr.write("使い方: node scripts/release.ts <PR の番号> [--check]\n");
  process.exit(2);
}

const results: StepResult[] = [];
/** 結果を記録して表示する。失敗なら、ここで止まる(表を出して、終了コード 1)。 */
const record = (name: string, status: StepResult["status"], note: string): void => {
  results.push({ name, status, note });
  process.stdout.write(`- ${name}: ${note}\n`);
  if (status === "fail") finish();
};
const finish = (): never => {
  process.stdout.write(`\n${formatReleaseTable(results)}\n`);
  process.exit(canContinue(results) ? 0 : 1);
};

function releaseNotesTop(ref: string): string | null {
  const text = tryGit(["show", `${ref}:data/release-notes.json`]);
  if (!text) return null;
  const top = (JSON.parse(text) as { releases: { version: string }[] }).releases[0]?.version ?? null;
  return top !== null && isVersion(top) ? top : null;
}

interface PrView {
  state: string;
  baseRefName: string;
  headRefName: string;
  headRefOid: string;
  isCrossRepository: boolean;
  mergeStateStatus: string;
  statusCheckRollup: RollupItem[];
  mergeCommit: { oid: string } | null;
  body: string;
}

const viewPr = (): PrView =>
  JSON.parse(
    gh([
      "pr",
      "view",
      prNumber,
      "--json",
      "state,baseRefName,headRefName,headRefOid,isCrossRepository,mergeStateStatus,statusCheckRollup,mergeCommit,body",
    ]),
  ) as PrView;

async function main() {
  const view = viewPr();

  // 1. CI と PR の状態
  const errors = checkMergeable({
    state: view.state,
    baseRefName: view.baseRefName,
    mergeStateStatus: view.mergeStateStatus,
    checks: normalizeChecks(view.statusCheckRollup),
  });
  for (const e of errors) results.push({ name: "CI と PR の状態", status: "fail", note: e });
  if (errors.length > 0) {
    process.stdout.write(`${errors.map((e) => `- ${e}`).join("\n")}\n`);
    finish();
  }
  record(
    "CI と PR の状態",
    view.state === "MERGED" ? "done" : "ok",
    view.state === "MERGED" ? "マージ済み" : "CI が成功、CLEAN",
  );

  // 2. リリースする版(確認した PR の先頭のコミット、またはマージコミットのリリースノートの先頭)
  git(["fetch", "--quiet", "origin", "main", "--tags"]);
  if (!view.mergeCommit) git(["fetch", "--quiet", "origin", `refs/pull/${prNumber}/head`]);
  const version = releaseNotesTop(view.mergeCommit?.oid ?? view.headRefOid);
  if (!version)
    return record("リリースノート", "fail", "data/release-notes.json の先頭の版を読めない(vX.Y.Z の形でない)");
  record("リリースノート", "ok", `先頭の版: ${version}`);
  if (checkOnly) {
    process.stdout.write("\n--check: マージの前の確認だけを実行しました。GitHub とファイルの内容は変えていません。\n");
    finish();
  }

  // 3. マージ(マージコミット。確認したコミットに固定する)
  let mergeCommit = view.mergeCommit?.oid ?? "";
  if (view.state === "MERGED") {
    record("マージ", "done", mergeCommit.slice(0, 7));
  } else {
    gh(["pr", "merge", prNumber, "--merge", "--match-head-commit", view.headRefOid]);
    mergeCommit = viewPr().mergeCommit?.oid ?? "";
    record("マージ", mergeCommit ? "ok" : "fail", mergeCommit ? mergeCommit.slice(0, 7) : "マージコミットを読めない");
  }
  git(["fetch", "--quiet", "origin", "main", "--tags"]);
  const entryErrors = checkReleaseEntry(releaseNotesTop(mergeCommit), version);
  if (entryErrors.length > 0) return record("マージコミットのリリースノート", "fail", entryErrors.join(" / "));
  record("マージコミットのリリースノート", "ok", `先頭が ${version}`);

  // 4. タグ(マージコミットへの軽量タグ)
  const tagPlan = planTag(tryGit(["rev-list", "-n", "1", `refs/tags/${version}`]), mergeCommit);
  if (tagPlan.action === "conflict") return record("タグ", "fail", tagPlan.reason);
  if (tagPlan.action === "exists") record("タグ", "done", `${version} は作成済み`);
  else {
    git(["tag", version, mergeCommit]);
    record("タグ", "ok", `${version} を作成`);
  }
  if (tryGit(["ls-remote", "--tags", "origin", `refs/tags/${version}`]))
    record("タグの push", "done", "リモートに存在");
  else {
    git(["push", "origin", `refs/tags/${version}`]);
    record("タグの push", "ok", version);
  }

  // 5. Release(release-tag.yml が作る。作られるまで待つ)
  let released = false;
  for (let i = 0; i < 30 && !released; i++) {
    try {
      gh(["release", "view", version]);
      released = true;
    } catch {
      await sleep(10_000);
    }
  }
  if (!released) {
    let run = "(取得できなかった)";
    try {
      run = gh([
        "run",
        "list",
        "--workflow",
        "release-tag.yml",
        "--limit",
        "1",
        "--json",
        "status,conclusion",
        "--jq",
        '.[0] | "\\(.status) \\(.conclusion)"',
      ]).trim();
    } catch {}
    return record("Release", "fail", `作られなかった。release-tag.yml の状態: ${run}`);
  }
  record("Release", "ok", `${version} が公開済み`);

  // 6. マイルストーン(未完了の Issue があれば、閉じずに止まる)
  const lines = gh([
    "api",
    "--paginate",
    "repos/{owner}/{repo}/milestones?state=all&per_page=100",
    "--jq",
    ".[] | {number, title, state}",
  ]);
  const found = lines
    .split("\n")
    .filter((l) => l.trim() !== "")
    .map((l) => JSON.parse(l) as { number: number; title: string; state: string })
    .find((m) => m.title === version);
  const open = found
    ? (
        JSON.parse(
          gh(["issue", "list", "--milestone", version, "--state", "open", "--limit", "200", "--json", "number"]),
        ) as { number: number }[]
      ).map((i) => i.number)
    : [];
  const milestonePlan = planMilestone(found ? { state: found.state, openIssues: open } : null);
  if (milestonePlan.action === "missing") record("マイルストーン", "skip", `${version} のマイルストーンがない`);
  else if (milestonePlan.action === "closed") record("マイルストーン", "done", "閉じている");
  else if (milestonePlan.action === "blocked") {
    return record(
      "マイルストーン",
      "fail",
      `未完了の Issue が残る: ${milestonePlan.issues.map((n) => `#${n}`).join(" ")}(閉じない)`,
    );
  } else {
    gh(["api", "-X", "PATCH", `repos/{owner}/{repo}/milestones/${found?.number}`, "-f", "state=closed"]);
    record("マイルストーン", "ok", `${version} を閉じた`);
  }

  // 7. ブランチの削除(リモートとローカル)
  const branch = view.headRefName;
  if (!isSafeBranchName(branch)) return record("ブランチの削除", "fail", "ブランチ名が安全な形でない(削除しない)");
  const remoteLine = tryGit(["ls-remote", "--heads", "origin", `refs/heads/${branch}`]);
  const worktrees = git(["worktree", "list", "--porcelain"]).split("\n");
  const current = tryGit(["branch", "--show-current"]);
  const plan = planBranch({
    name: branch,
    crossRepository: view.isCrossRepository,
    remoteTip: remoteLine ? (remoteLine.split(/\s+/)[0] ?? null) : null,
    headOid: view.headRefOid,
    localExists: tryGit(["rev-parse", "--verify", "--quiet", `refs/heads/${branch}`]) !== null,
    checkedOutElsewhere: worktrees.includes(`branch refs/heads/${branch}`) && current !== branch,
    mergedIntoMain: tryGit(["merge-base", "--is-ancestor", `refs/heads/${branch}`, "origin/main"]) !== null,
  });
  const remoteNote: Record<typeof plan.remote, string> = {
    delete: "",
    gone: "すでにない",
    "skip-protected": "保護対象の名前のため残す",
    "skip-fork": "フォークからの PR のため残す",
    "skip-moved": "リモートの先頭が PR の先頭から動いているため残す",
  };
  if (plan.remote === "delete") {
    git(["push", "origin", "--delete", `refs/heads/${branch}`]);
    record("リモートのブランチ", "ok", `${branch} を削除`);
  } else record("リモートのブランチ", plan.remote === "gone" ? "done" : "skip", remoteNote[plan.remote]);

  if (plan.local === "delete") {
    // 残す理由があるときは、先へ進めて(段階 8 と表を出す)、この段階は「省略」にする
    let keepReason: string | null = null;
    if (current === branch) {
      if (tryGit(["status", "--porcelain"])) keepReason = "未コミットの変更があるため、main へ切り替えず残す";
      else if (tryGit(["switch", "main"]) === null)
        keepReason = "main へ切り替えられない(ローカルに main がない、または別の作業ツリーで出ている)ため残す";
    }
    if (keepReason) record("ローカルのブランチ", "skip", keepReason);
    else {
      // origin/main に含まれることは確認済み。含まれる分だけを消すので、失うコミットはない
      git(["branch", "-D", branch]);
      record("ローカルのブランチ", "ok", `${branch} を削除(origin/main に含まれる)`);
    }
  } else {
    const note = {
      gone: "すでにない",
      "in-worktree": "別の作業ツリーで出ているため残す",
      "skip-protected": "保護対象の名前のため残す",
      "skip-unmerged": "origin/main に含まれないため残す",
    }[plan.local];
    record("ローカルのブランチ", plan.local === "gone" ? "done" : "skip", note);
  }

  // 8. 確認: Closes の Issue、main
  const closed: string[] = [];
  const stillOpen: string[] = [];
  for (const n of parseCloses(view.body)) {
    const state = gh(["issue", "view", String(n), "--json", "state", "--jq", ".state"]).trim();
    (state === "CLOSED" ? closed : stillOpen).push(`#${n}`);
  }
  if (tryGit(["branch", "--show-current"]) === "main") tryGit(["pull", "--ff-only", "--quiet", "origin", "main"]);
  const behind = tryGit(["rev-list", "--count", "main..origin/main"]);
  results.push({
    name: "main",
    status: behind === "0" ? "ok" : "skip",
    note: behind === "0" ? "最新" : "ローカルの main が最新でない(main に切り替えて pull する)",
  });
  record(
    "Closes の Issue",
    stillOpen.length === 0 ? "ok" : "fail",
    stillOpen.length === 0 ? `${closed.length} 件が閉じている` : `閉じていない: ${stillOpen.join(" ")}`,
  );

  finish();
}

main().catch((error: Error) => {
  results.push({ name: "実行", status: "fail", note: `例外: ${error.message.split("\n")[0]}` });
  finish();
});
