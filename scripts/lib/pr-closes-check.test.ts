import { describe, expect, it } from "vitest";
import { checkPrCloses, type PrClosesInput, parseCloses, targetVersion } from "./pr-closes-check.ts";

const base = (over: Partial<PrClosesInput> = {}): PrClosesInput => ({
  closes: [1, 2],
  milestones: { 1: "v0.5.0", 2: "v0.5.0" },
  latestRelease: "v0.5.0",
  milestone: { title: "v0.5.0", openIssues: [1, 2] },
  ...over,
});

describe("parseCloses", () => {
  it("Closesの行_番号を取り出す", () => {
    expect(parseCloses("概要\n\nCloses #1\nCloses #22\nfixes #3\n")).toEqual([1, 22, 3]);
  });

  it("Refs_取り出さない", () => {
    expect(parseCloses("Refs #5\nrefs #6")).toEqual([]);
  });

  it("コロン付きと箇条書きと1行に複数と活用形_GitHubと同じく取り出す", () => {
    expect(parseCloses("Closes: #1\n- Fixes #2\nclosed #3, resolves #4\nResolved #5")).toEqual([1, 2, 3, 4, 5]);
  });

  it("コードブロックの中_取り出さない", () => {
    expect(parseCloses("```md\nCloses #9\n```\nCloses #10")).toEqual([10]);
  });

  it("インラインコードの中_取り出さない", () => {
    expect(parseCloses("書き方は `Closes #9` のように書く")).toEqual([]);
  });

  it("同じ番号が重なる_1 つにする", () => {
    expect(parseCloses("Closes #1\nCloses #1")).toEqual([1]);
  });
});

describe("targetVersion", () => {
  it("どれかがマイルストーンを持つ_その版を返す", () => {
    expect(targetVersion(base())).toBe("v0.5.0");
  });

  it("どれもマイルストーンを持たない_nullを返す", () => {
    expect(targetVersion({ closes: [1], milestones: { 1: null } })).toBeNull();
  });
});

describe("checkPrCloses", () => {
  it("リリースノートの版がない_報告する", () => {
    const errors = checkPrCloses(base({ latestRelease: null }));
    expect(errors).toEqual(["リリースノートの最新の版が、Closes のマイルストーン(v0.5.0)と違う"]);
  });

  it("すべてそろっている_エラーなし", () => {
    expect(checkPrCloses(base())).toEqual([]);
  });

  it("Closesがない_検査しない", () => {
    expect(checkPrCloses(base({ closes: [], milestones: {} }))).toEqual([]);
  });

  it("どのIssueもマイルストーンがない_Issue単位のPRとして検査しない", () => {
    expect(checkPrCloses(base({ milestones: { 1: null, 2: null }, latestRelease: "v0.1.0" }))).toEqual([]);
  });

  it("一部のIssueだけマイルストーンがない_その番号を報告する", () => {
    const errors = checkPrCloses(base({ milestones: { 1: "v0.5.0", 2: null } }));
    expect(errors).toEqual(["Closes #2: マイルストーンがない(ほかの Issue は版のマイルストーンを持つ)"]);
  });

  it("複数の版にまたがる_報告する", () => {
    const errors = checkPrCloses(base({ milestones: { 1: "v0.5.0", 2: "v0.6.0" } }));
    expect(errors).toEqual(["Closes の Issue が、複数の版のマイルストーンにまたがる"]);
  });

  it("リリースノートの最新の版が違う_報告する", () => {
    const errors = checkPrCloses(base({ latestRelease: "v0.4.0" }));
    expect(errors).toEqual(["リリースノートの最新の版が、Closes のマイルストーン(v0.5.0)と違う"]);
  });

  it("同名のマイルストーンがない_報告する", () => {
    expect(checkPrCloses(base({ milestone: null }))).toEqual(["マイルストーン v0.5.0 が見つからない"]);
  });

  it("マイルストーンにClosesにない未完了のIssueが残る_その番号を報告する", () => {
    const errors = checkPrCloses(base({ milestone: { title: "v0.5.0", openIssues: [1, 2, 3, 4] } }));
    expect(errors).toEqual([
      "マイルストーン v0.5.0 に、Closes にない未完了の Issue #3 が残る",
      "マイルストーン v0.5.0 に、Closes にない未完了の Issue #4 が残る",
    ]);
  });
});
