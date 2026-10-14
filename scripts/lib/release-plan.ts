/**
 * リリースの手順(scripts/release.ts)の判定。副作用のない関数にして、`gh` と `git` の出力のフィクスチャで単体テストする。
 * 報告は場所と種類だけ(値は扱わない)。段階が目的の状態にあるときは「済み」として扱い、再実行してよい。
 */

export type StepStatus = "ok" | "done" | "skip" | "fail";

export interface StepResult {
  name: string;
  status: StepStatus;
  note: string;
}

export interface CheckRun {
  name: string;
  /** SUCCESS / FAILURE / SKIPPED / NEUTRAL / CANCELLED など。まだ終わっていないときは空 */
  conclusion: string;
}

export interface PrState {
  state: string;
  baseRefName: string;
  mergeStateStatus: string;
  checks: CheckRun[];
}

export const REQUIRED_CHECK = "ci-ok";

/** `gh pr view --json statusCheckRollup` の要素。CheckRun は name と conclusion、StatusContext は context と state を持つ。 */
export interface RollupItem {
  name?: string;
  conclusion?: string;
  context?: string;
  state?: string;
}

/** CheckRun と StatusContext を、名前と結論の組にそろえる。 */
export function normalizeChecks(rollup: RollupItem[]): CheckRun[] {
  return rollup.map((c) => ({ name: c.name ?? c.context ?? "(名前なし)", conclusion: c.conclusion ?? c.state ?? "" }));
}

/**
 * マージの前の確認。CI のジョブがすべて成功(または、変更がなく動かなかった SKIPPED、NEUTRAL)で、
 * `ci-ok` が成功で、PR が CLEAN。
 */
export function checkMergeable(pr: PrState): string[] {
  if (pr.state === "MERGED") return [];
  const errors: string[] = [];
  if (pr.state !== "OPEN") errors.push(`PR が開いていない(状態: ${pr.state})`);
  if (pr.baseRefName !== "main") errors.push(`PR の基準が main でない(${pr.baseRefName})`);
  const bad = pr.checks.filter((c) => !["SUCCESS", "SKIPPED", "NEUTRAL"].includes(c.conclusion));
  for (const c of bad) errors.push(`CI のジョブ ${c.name} が成功していない(${c.conclusion || "未完了"})`);
  const required = pr.checks.find((c) => c.name === REQUIRED_CHECK);
  if (!required) errors.push(`CI の ${REQUIRED_CHECK} がない`);
  else if (required.conclusion !== "SUCCESS" && bad.every((c) => c.name !== REQUIRED_CHECK)) {
    errors.push(`CI の ${REQUIRED_CHECK} が成功でない(${required.conclusion})`);
  }
  if (pr.mergeStateStatus !== "CLEAN") errors.push(`PR の状態が CLEAN でない(${pr.mergeStateStatus})`);
  return errors;
}

/** リリースノートの先頭の版が、リリースする版と同じであること。 */
export function checkReleaseEntry(top: string | null, version: string): string[] {
  return top === version ? [] : [`マージコミットの data/release-notes.json の先頭が ${version} でない`];
}

const VERSION = /^v\d+\.\d+\.\d+$/;
// 先頭が `-` でない。gh と git の引数に渡す名前の検証
const BRANCH = /^[A-Za-z0-9][A-Za-z0-9._/#-]*$/;
/** 削除してはいけないブランチの名前(長期のブランチ) */
const PROTECTED = /^(?:main|master|dev|develop|release(?:\/.*)?|hotfix)$/;

export const isVersion = (value: string): boolean => VERSION.test(value);
export const isSafeBranchName = (value: string): boolean => BRANCH.test(value) && !value.includes("..");
export const isProtectedBranch = (value: string): boolean => PROTECTED.test(value);

export type TagPlan = { action: "create" } | { action: "exists" } | { action: "conflict"; reason: string };

/** タグの扱い。マージコミットに同名のタグがあれば済み。別のコミットにあれば止める。 */
export function planTag(existingTagCommit: string | null, mergeCommit: string): TagPlan {
  if (existingTagCommit === null) return { action: "create" };
  if (existingTagCommit === mergeCommit) return { action: "exists" };
  return { action: "conflict", reason: "同名のタグが、マージコミットとは別のコミットにある" };
}

export type MilestonePlan =
  | { action: "close" }
  | { action: "closed" }
  | { action: "missing" }
  | { action: "blocked"; issues: number[] };

/** マイルストーンの扱い。閉じていれば済み。未完了の Issue があれば閉じずに止める。 */
export function planMilestone(milestone: { state: string; openIssues: number[] } | null): MilestonePlan {
  if (milestone === null) return { action: "missing" };
  if (milestone.state === "closed") return { action: "closed" };
  return milestone.openIssues.length > 0 ? { action: "blocked", issues: milestone.openIssues } : { action: "close" };
}

export interface BranchPlan {
  remote: "delete" | "gone" | "skip-protected" | "skip-fork" | "skip-moved";
  local: "delete" | "gone" | "in-worktree" | "skip-protected" | "skip-unmerged";
}

/**
 * ブランチの削除。次は消さない: 保護対象の名前、フォークからの PR、リモートの先頭が PR の先頭から動いたブランチ(リモート)、
 * 別の作業ツリーで出ているブランチ、`origin/main` に含まれない(未マージの)ブランチ(ローカル)。
 */
export function planBranch(input: {
  name: string;
  crossRepository: boolean;
  remoteTip: string | null;
  headOid: string;
  localExists: boolean;
  checkedOutElsewhere: boolean;
  mergedIntoMain: boolean;
}): BranchPlan {
  const isProtected = isProtectedBranch(input.name);
  const remote = isProtected
    ? "skip-protected"
    : input.crossRepository
      ? "skip-fork"
      : input.remoteTip === null
        ? "gone"
        : input.remoteTip === input.headOid
          ? "delete"
          : "skip-moved";
  const local = !input.localExists
    ? "gone"
    : isProtected
      ? "skip-protected"
      : input.checkedOutElsewhere
        ? "in-worktree"
        : input.mergedIntoMain
          ? "delete"
          : "skip-unmerged";
  return { remote, local };
}

const MARK: Record<StepStatus, string> = { ok: "成功", done: "済み", skip: "省略", fail: "失敗" };

/** 段階ごとの結果の一覧(表)。 */
export function formatReleaseTable(results: StepResult[]): string {
  const rows = results.map((r) => `| ${r.name} | ${MARK[r.status]} | ${r.note} |`);
  return ["| 段階 | 結果 | 内容 |", "| --- | --- | --- |", ...rows].join("\n");
}

/** 先へ進んでよいか(失敗がない)。 */
export function canContinue(results: StepResult[]): boolean {
  return results.every((r) => r.status !== "fail");
}
