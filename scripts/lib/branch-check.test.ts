import { describe, expect, it } from "vitest";
import { checkBranch } from "./branch-check.ts";

describe("checkBranch", () => {
  it("ブランチ名が main_止めて作業ブランチの作り方を案内する", () => {
    const result = checkBranch("main");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain("git switch -c");
  });

  it("作業ブランチ_通す", () => {
    expect(checkBranch("feat/#290-v0.43.0")).toEqual({ ok: true });
    expect(checkBranch("hotfix/#1-fix")).toEqual({ ok: true });
  });

  it("main で始まるだけの名前_通す", () => {
    expect(checkBranch("main-fix")).toEqual({ ok: true });
  });

  it("detached HEAD(リベース中を含む)_通す", () => {
    expect(checkBranch(null)).toEqual({ ok: true });
  });
});
