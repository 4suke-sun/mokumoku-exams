import { describe, expect, it } from "vitest";
import {
  canContinue,
  checkMergeable,
  checkReleaseEntry,
  formatReleaseTable,
  isProtectedBranch,
  isSafeBranchName,
  isVersion,
  normalizeChecks,
  type PrState,
  planBranch,
  planMilestone,
  planTag,
} from "./release-plan.ts";

const okPr = (over: Partial<PrState> = {}): PrState => ({
  state: "OPEN",
  baseRefName: "main",
  mergeStateStatus: "CLEAN",
  checks: [
    { name: "check", conclusion: "SUCCESS" },
    { name: "e2e", conclusion: "SKIPPED" },
    { name: "ci-ok", conclusion: "SUCCESS" },
  ],
  ...over,
});

describe("checkMergeable", () => {
  it("CIが成功しCLEAN_エラーなし", () => {
    expect(checkMergeable(okPr())).toEqual([]);
  });

  it("すでにマージ済み_確認しない", () => {
    expect(checkMergeable(okPr({ state: "MERGED", mergeStateStatus: "UNKNOWN" }))).toEqual([]);
  });

  it("CIのジョブが失敗_ジョブ名を報告する", () => {
    const pr = okPr({
      checks: [
        { name: "app", conclusion: "FAILURE" },
        { name: "ci-ok", conclusion: "SUCCESS" },
      ],
    });
    expect(checkMergeable(pr)).toEqual(["CI のジョブ app が成功していない(FAILURE)"]);
  });

  it("CIが未完了_未完了として報告する", () => {
    const pr = okPr({ checks: [{ name: "ci-ok", conclusion: "" }] });
    expect(checkMergeable(pr)).toEqual(["CI のジョブ ci-ok が成功していない(未完了)"]);
  });

  it("ci-okがSKIPPED_成功ではないと報告する", () => {
    const pr = okPr({ checks: [{ name: "ci-ok", conclusion: "SKIPPED" }] });
    expect(checkMergeable(pr)).toEqual(["CI の ci-ok が成功でない(SKIPPED)"]);
  });

  it("CIのジョブが0件_ci-okがないと報告する", () => {
    expect(checkMergeable(okPr({ checks: [] }))).toEqual(["CI の ci-ok がない"]);
  });

  it("複数のジョブが失敗や未完了_すべて報告する", () => {
    const pr = okPr({
      checks: [
        { name: "app", conclusion: "FAILURE" },
        { name: "e2e", conclusion: "" },
        { name: "ci-ok", conclusion: "SUCCESS" },
      ],
    });
    expect(checkMergeable(pr)).toHaveLength(2);
  });

  it("ci-okがない_報告する", () => {
    expect(checkMergeable(okPr({ checks: [{ name: "check", conclusion: "SUCCESS" }] }))).toEqual([
      "CI の ci-ok がない",
    ]);
  });

  it("CLEANでない_状態を報告する", () => {
    expect(checkMergeable(okPr({ mergeStateStatus: "DIRTY" }))).toEqual(["PR の状態が CLEAN でない(DIRTY)"]);
  });

  it("基準がmainでない_報告する", () => {
    expect(checkMergeable(okPr({ baseRefName: "dev" }))).toEqual(["PR の基準が main でない(dev)"]);
  });

  it("閉じたPR_開いていないと報告する", () => {
    expect(checkMergeable(okPr({ state: "CLOSED" }))[0]).toContain("PR が開いていない");
  });
});

describe("checkReleaseEntry", () => {
  it("先頭が同じ版_エラーなし", () => {
    expect(checkReleaseEntry("v0.5.0", "v0.5.0")).toEqual([]);
  });

  it("先頭が違う版かない_報告する", () => {
    expect(checkReleaseEntry("v0.4.0", "v0.5.0")).toHaveLength(1);
    expect(checkReleaseEntry(null, "v0.5.0")).toHaveLength(1);
  });
});

describe("planTag", () => {
  it("タグがない_作る", () => {
    expect(planTag(null, "abc")).toEqual({ action: "create" });
  });

  it("マージコミットに同名のタグがある_済みとして扱う", () => {
    expect(planTag("abc", "abc")).toEqual({ action: "exists" });
  });

  it("別のコミットに同名のタグがある_止める", () => {
    expect(planTag("def", "abc").action).toBe("conflict");
  });
});

describe("planMilestone", () => {
  it("未完了のIssueがない_閉じる", () => {
    expect(planMilestone({ state: "open", openIssues: [] })).toEqual({ action: "close" });
  });

  it("未完了のIssueが残る_閉じずに止める", () => {
    expect(planMilestone({ state: "open", openIssues: [3, 4] })).toEqual({ action: "blocked", issues: [3, 4] });
  });

  it("すでに閉じている_済みとして扱う", () => {
    expect(planMilestone({ state: "closed", openIssues: [] })).toEqual({ action: "closed" });
  });

  it("マイルストーンがない_見つからないと返す", () => {
    expect(planMilestone(null)).toEqual({ action: "missing" });
  });
});

describe("planBranch", () => {
  const base = {
    name: "feat/#1-x",
    crossRepository: false,
    remoteTip: "abc",
    headOid: "abc",
    localExists: true,
    checkedOutElsewhere: false,
    mergedIntoMain: true,
  };

  it("リモートとローカルにある_両方消す", () => {
    expect(planBranch(base)).toEqual({ remote: "delete", local: "delete" });
  });

  it("すでにない_済みとして扱う", () => {
    expect(planBranch({ ...base, remoteTip: null, localExists: false })).toEqual({ remote: "gone", local: "gone" });
  });

  it("別の作業ツリーで出ている_ローカルは消さない", () => {
    expect(planBranch({ ...base, checkedOutElsewhere: true }).local).toBe("in-worktree");
  });

  it.each([["main"], ["dev"], ["develop"], ["release/1.0"]])("保護対象の名前_どちらも消さない(%s)", (name) => {
    expect(planBranch({ ...base, name })).toEqual({ remote: "skip-protected", local: "skip-protected" });
  });

  it("フォークからのPR_リモートは消さない", () => {
    expect(planBranch({ ...base, crossRepository: true }).remote).toBe("skip-fork");
  });

  it("リモートの先頭がPRの先頭から動いた_リモートは消さない", () => {
    expect(planBranch({ ...base, remoteTip: "def" }).remote).toBe("skip-moved");
  });

  it("origin/mainに含まれない_ローカルは消さない", () => {
    expect(planBranch({ ...base, mergedIntoMain: false }).local).toBe("skip-unmerged");
  });

  it("リモートは済みでローカルがある_ローカルだけ消す", () => {
    expect(planBranch({ ...base, remoteTip: null })).toEqual({ remote: "gone", local: "delete" });
  });
});

describe("名前の検証", () => {
  it("版_vX.Y.Zの形だけ通す", () => {
    expect(isVersion("v0.44.0")).toBe(true);
    expect(isVersion("0.44.0")).toBe(false);
    expect(isVersion("v0.44")).toBe(false);
    expect(isVersion("--force")).toBe(false);
  });

  it("ブランチ名_先頭が-や..を含むものを通さない", () => {
    expect(isSafeBranchName("feat/#291-v0.44.0")).toBe(true);
    expect(isSafeBranchName("-delete")).toBe(false);
    expect(isSafeBranchName("a/../b")).toBe(false);
    expect(isSafeBranchName("")).toBe(false);
  });

  it("保護対象_main_dev_releaseを含む", () => {
    expect(isProtectedBranch("main")).toBe(true);
    expect(isProtectedBranch("feat/x")).toBe(false);
  });
});

describe("normalizeChecks", () => {
  it("CheckRunとStatusContext_名前と結論にそろえる", () => {
    expect(
      normalizeChecks([{ name: "check", conclusion: "SUCCESS" }, { context: "legacy/ci", state: "PENDING" }, {}]),
    ).toEqual([
      { name: "check", conclusion: "SUCCESS" },
      { name: "legacy/ci", conclusion: "PENDING" },
      { name: "(名前なし)", conclusion: "" },
    ]);
  });
});

describe("formatReleaseTable", () => {
  it("段階ごとの結果_表にする", () => {
    const table = formatReleaseTable([
      { name: "マージ", status: "ok", note: "abc1234" },
      { name: "タグ", status: "done", note: "v0.5.0" },
    ]);
    expect(table).toContain("| マージ | 成功 | abc1234 |");
    expect(table).toContain("| タグ | 済み | v0.5.0 |");
  });

  it("失敗がある_続けない", () => {
    expect(canContinue([{ name: "a", status: "ok", note: "" }])).toBe(true);
    expect(canContinue([{ name: "a", status: "fail", note: "" }])).toBe(false);
  });
});
