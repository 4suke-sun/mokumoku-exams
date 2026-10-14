import { describe, expect, it } from "vitest";
import {
  excludeAtBase,
  formatStatus,
  parseMergedBranches,
  parseMilestones,
  parsePullRequests,
  parseUnpushed,
  parseWorktrees,
  type StatusReport,
  withLocalOnly,
} from "./status.ts";

describe("parseWorktrees", () => {
  const output = [
    "worktree /work/main",
    "HEAD 0123456789abcdef0123456789abcdef01234567",
    "branch refs/heads/feat/#1-x",
    "",
    "worktree /work/wt-detached",
    "HEAD abcdef0123456789abcdef0123456789abcdef01",
    "detached",
    "",
  ].join("\n");

  it("通常とdetached_ブランチと短いIDと場所を取り出す", () => {
    expect(parseWorktrees(output)).toEqual([
      { path: "/work/main", branch: "feat/#1-x", head: "0123456", detached: false },
      { path: "/work/wt-detached", branch: null, head: "abcdef0", detached: true },
    ]);
  });

  it("空の出力_空の配列を返す", () => {
    expect(parseWorktrees("")).toEqual([]);
  });
});

describe("parseUnpushed", () => {
  it("aheadとgone_先に進んだブランチと消えたupstreamだけを返す", () => {
    const output = [
      "main|origin/main|",
      "feat/a|origin/main|[ahead 2, behind 5]",
      "feat/b|origin/feat/b|[ahead 3]",
      "feat/c|origin/feat/c|[gone]",
      "feat/d|origin/main|[behind 4]",
      "feat/e||",
    ].join("\n");
    expect(parseUnpushed(output)).toEqual([
      { branch: "feat/a", ahead: 2, upstream: "origin/main", gone: false },
      { branch: "feat/b", ahead: 3, upstream: "origin/feat/b", gone: false },
      { branch: "feat/c", ahead: 0, upstream: "origin/feat/c", gone: true },
    ]);
  });

  it("upstreamのないブランチのリモートにないコミット_件数があれば足す", () => {
    expect(withLocalOnly([], "feat/e", 3)).toEqual([{ branch: "feat/e", ahead: 3, upstream: null, gone: false }]);
    expect(withLocalOnly([], "feat/e", 0)).toEqual([]);
  });
});

describe("parseMergedBranches", () => {
  it("現在と基準のブランチ_除いて名前を返す", () => {
    const output = "* feat/now\n  main\n  feat/old\n+ feat/in-worktree\n";
    expect(parseMergedBranches(output, ["main", "feat/now"])).toEqual(["feat/old", "feat/in-worktree"]);
  });

  it("リモートのHEADの別名と基準_除く", () => {
    const output = "  origin/HEAD -> origin/main\n  origin/main\n  origin/feat/done\n";
    expect(parseMergedBranches(output, ["origin/main", "origin/HEAD"])).toEqual(["origin/feat/done"]);
  });

  it("detached HEADの表示_除く", () => {
    expect(parseMergedBranches("* (HEAD detached at abc)\n  feat/x\n", [])).toEqual(["feat/x"]);
  });
});

describe("excludeAtBase", () => {
  it("先頭が基準と同じブランチ_コミットのない新しいブランチとして除く", () => {
    const tips = { "feat/new": "aaa", "feat/old": "bbb" };
    expect(excludeAtBase(["feat/new", "feat/old"], tips, "aaa")).toEqual(["feat/old"]);
  });
});

describe("parseMilestones", () => {
  it("マイルストーンと未完了のIssue_番号順に並べる", () => {
    const issues = {
      "v0.1.0": JSON.stringify([
        { number: 9, title: "b" },
        { number: 3, title: "a" },
      ]),
    };
    expect(parseMilestones(JSON.stringify([{ title: "v0.1.0" }, { title: "v0.2.0" }]), issues)).toEqual([
      {
        title: "v0.1.0",
        openIssues: [
          { number: 3, title: "a" },
          { number: 9, title: "b" },
        ],
      },
      { title: "v0.2.0", openIssues: [] },
    ]);
  });
});

describe("parsePullRequests", () => {
  it("PRの一覧_番号とタイトルとブランチと下書きを返す", () => {
    const json = JSON.stringify([{ number: 5, title: "t", headRefName: "feat/x", isDraft: true }]);
    expect(parsePullRequests(json)).toEqual([{ number: 5, title: "t", branch: "feat/x", draft: true }]);
  });
});

describe("formatStatus", () => {
  const full: StatusReport = {
    latestTag: { ok: true, value: "v0.1.0" },
    milestones: { ok: true, value: [{ title: "v0.2.0", openIssues: [{ number: 3, title: "題" }] }] },
    pullRequests: { ok: true, value: [{ number: 5, title: "PR", branch: "feat/x", draft: false }] },
    unpushed: { ok: true, value: [{ branch: "feat/x", ahead: 2, upstream: null, gone: false }] },
    mergedLocal: { ok: true, value: ["feat/old"] },
    mergedRemote: { ok: true, value: [] },
    worktrees: { ok: true, value: [{ path: "/w", branch: "feat/x", head: "abc1234", detached: false }] },
  };

  it("すべて取れた_項目ごとに表示し_空の項目はなしと出す", () => {
    const text = formatStatus(full);
    expect(text).toContain("- v0.1.0");
    expect(text).toContain("- v0.2.0(未完了 1 件)\n    - #3 題");
    expect(text).toContain("- #5 PR(feat/x)");
    expect(text).toContain("- feat/x: 2 件(どのリモートにもない)");
    expect(text).toContain("## マージ済みで残ったブランチ(リモート)\n- なし");
  });

  it("GitHubの項目が取れない_取得できなかったと表示し_なしとは区別する", () => {
    const text = formatStatus({
      ...full,
      milestones: { ok: false, reason: "gh が使えない" },
      pullRequests: { ok: false, reason: "gh が使えない" },
    });
    expect(text).toContain("## 開いた PR\n- (取得できなかった: gh が使えない)");
    expect(text).not.toContain("## 開いた PR\n- なし");
    expect(text).toContain("- v0.1.0");
  });

  it("タグがない_なしと表示する", () => {
    expect(formatStatus({ ...full, latestTag: { ok: true, value: null } })).toContain("## 最新のタグ\n- なし");
  });

  it("upstreamが消えている_消えていると表示する", () => {
    const text = formatStatus({
      ...full,
      unpushed: { ok: true, value: [{ branch: "feat/g", ahead: 0, upstream: "origin/feat/g", gone: true }] },
    });
    expect(text).toContain("- feat/g: upstream(origin/feat/g)がリモートで消えている");
  });
});
