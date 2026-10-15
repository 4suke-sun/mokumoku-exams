/**
 * 作業の状態の表示(npm run status)の、取得結果の解釈と整形。
 * `git` と `gh` の出力の解釈を純粋な関数にして、フィクスチャで単体テストする(実行は scripts/status.ts)。
 * 取れなかった項目は、空の項目と区別して表示する。
 */

export type Fetched<T> = { ok: true; value: T } | { ok: false; reason: string };

export interface Worktree {
  path: string;
  branch: string | null;
  head: string;
  /** detached HEAD */
  detached: boolean;
}

export interface UnpushedBranch {
  branch: string;
  /** upstream との差(upstream がないブランチは、どのリモートにもないコミットの数) */
  ahead: number;
  upstream: string | null;
  /** upstream がリモートで消えている */
  gone: boolean;
}

export interface MilestoneStatus {
  title: string;
  openIssues: { number: number; title: string }[];
}

export interface PullRequestStatus {
  number: number;
  title: string;
  branch: string;
  draft: boolean;
}

export interface StatusReport {
  latestTag: Fetched<string | null>;
  milestones: Fetched<MilestoneStatus[]>;
  pullRequests: Fetched<PullRequestStatus[]>;
  unpushed: Fetched<UnpushedBranch[]>;
  mergedLocal: Fetched<string[]>;
  mergedRemote: Fetched<string[]>;
  worktrees: Fetched<Worktree[]>;
}

/** `git worktree list --porcelain` の出力を解釈する。 */
export function parseWorktrees(output: string): Worktree[] {
  const result: Worktree[] = [];
  for (const block of output.split(/\n\s*\n/)) {
    const lines = block.split("\n").filter((l) => l !== "");
    const path = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    if (!path) continue;
    const branch = lines.find((l) => l.startsWith("branch "))?.slice("branch ".length) ?? null;
    result.push({
      path,
      branch: branch?.replace(/^refs\/heads\//, "") ?? null,
      head: (lines.find((l) => l.startsWith("HEAD ")) ?? "").slice("HEAD ".length, "HEAD ".length + 7),
      detached: lines.includes("detached"),
    });
  }
  return result;
}

/**
 * `git for-each-ref --format='%(refname:short)|%(upstream:short)|%(upstream:track)' refs/heads` の出力から、
 * upstream より進んでいるブランチを取り出す。`[ahead 2, behind 5]`、`[ahead 3]`、`[gone]`、空(同じ)を読む。
 */
export function parseUnpushed(output: string): UnpushedBranch[] {
  const result: UnpushedBranch[] = [];
  for (const line of output.split("\n")) {
    if (line.trim() === "") continue;
    const [branch = "", upstream = "", track = ""] = line.split("|");
    const gone = track.includes("gone");
    const ahead = Number(track.match(/ahead (\d+)/)?.[1] ?? 0);
    if (gone || ahead > 0) result.push({ branch, ahead, upstream: upstream || null, gone });
  }
  return result;
}

/** upstream のないブランチの、どのリモートにもないコミット数(`git rev-list --count <branch> --not --remotes`)を足す。 */
export function withLocalOnly(unpushed: UnpushedBranch[], branch: string, count: number): UnpushedBranch[] {
  return count > 0 ? [...unpushed, { branch, ahead: count, upstream: null, gone: false }] : unpushed;
}

/** `git branch --merged` / `git branch -r --merged` の出力から、残っているブランチ名を取り出す(基準のブランチは除く)。 */
export function parseMergedBranches(output: string, exclude: string[]): string[] {
  return output
    .split("\n")
    .map((l) =>
      l
        .replace(/^[*+]?\s+/, "")
        .replace(/\s+->\s+.*$/, "")
        .trim(),
    )
    .filter((name) => name !== "" && !exclude.includes(name) && !name.startsWith("("));
}

/** 基準のブランチと先頭が同じブランチ(コミットのない新しいブランチ)は、マージ済みで残ったものではないので除く。 */
export function excludeAtBase(branches: string[], tips: Record<string, string>, baseTip: string): string[] {
  return branches.filter((b) => tips[b] !== baseTip);
}

export function parseMilestones(
  milestonesJson: string,
  openIssuesByMilestone: Record<string, string>,
): MilestoneStatus[] {
  const milestones = JSON.parse(milestonesJson) as { title: string }[];
  return milestones.map((m) => ({
    title: m.title,
    openIssues: (JSON.parse(openIssuesByMilestone[m.title] ?? "[]") as { number: number; title: string }[]).sort(
      (a, b) => a.number - b.number,
    ),
  }));
}

export function parsePullRequests(json: string): PullRequestStatus[] {
  return (JSON.parse(json) as { number: number; title: string; headRefName: string; isDraft: boolean }[]).map((p) => ({
    number: p.number,
    title: p.title,
    branch: p.headRefName,
    draft: p.isDraft,
  }));
}

function section<T>(title: string, fetched: Fetched<T>, render: (value: T) => string[]): string[] {
  if (!fetched.ok) return [`## ${title}`, `- (取得できなかった: ${fetched.reason})`, ""];
  const lines = render(fetched.value);
  return [`## ${title}`, ...(lines.length > 0 ? lines : ["- なし"]), ""];
}

export function formatStatus(report: StatusReport): string {
  const lines = [
    ...section("最新のタグ", report.latestTag, (tag) => (tag ? [`- ${tag}`] : [])),
    ...section("開いたマイルストーンと未完了の Issue", report.milestones, (ms) =>
      ms.flatMap((m) => [
        `- ${m.title}(未完了 ${m.openIssues.length} 件)`,
        ...m.openIssues.map((i) => `    - #${i.number} ${i.title}`),
      ]),
    ),
    ...section("開いた PR", report.pullRequests, (prs) =>
      prs.map((p) => `- #${p.number}${p.draft ? "(下書き)" : ""} ${p.title}(${p.branch})`),
    ),
    ...section("未 push のコミット", report.unpushed, (bs) =>
      bs.map((b) =>
        b.gone
          ? `- ${b.branch}: upstream(${b.upstream ?? "?"})がリモートで消えている`
          : `- ${b.branch}: ${b.ahead} 件${b.upstream ? `(${b.upstream} より先)` : "(どのリモートにもない)"}`,
      ),
    ),
    ...section("マージ済みで残ったブランチ(ローカル)", report.mergedLocal, (bs) => bs.map((b) => `- ${b}`)),
    ...section("マージ済みで残ったブランチ(リモート)", report.mergedRemote, (bs) => bs.map((b) => `- ${b}`)),
    ...section("作業ツリー", report.worktrees, (ws) =>
      ws.map((w) => `- ${w.branch ?? (w.detached ? "(detached)" : "(不明)")} ${w.head} ${w.path}`),
    ),
  ];
  return `${lines.join("\n").trimEnd()}\n`;
}
