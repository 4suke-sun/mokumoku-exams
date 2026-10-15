import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  addEntries,
  isCovered,
  isReusable,
  type LedgerEntry,
  parseLedger,
  patchIdOf,
  requiredKinds,
  rulesHash,
} from "./inspection-ledger.ts";

const entry = (over: Partial<LedgerEntry> = {}): LedgerEntry => ({
  patchId: "p1",
  kind: "inspector",
  verdict: "OK",
  rules: "r1",
  ...over,
});

describe("isCovered", () => {
  it("同じ差分・同じ基準で OK_読み直さない", () => {
    expect(isCovered({ entries: [entry()] }, "p1", ["inspector"], "r1")).toBe(true);
  });

  it("記録のない差分_読み直す", () => {
    expect(isCovered({ entries: [entry()] }, "p2", ["inspector"], "r1")).toBe(false);
  });

  it("基準が変わった_読み直す", () => {
    expect(isCovered({ entries: [entry()] }, "p1", ["inspector"], "r2")).toBe(false);
  });

  it("判定が WARN_読み直す", () => {
    expect(isCovered({ entries: [entry({ verdict: "WARN" })] }, "p1", ["inspector"], "r1")).toBe(false);
  });

  it("深めの検査が要る差分に記録がない_読み直す", () => {
    expect(isCovered({ entries: [entry()] }, "p1", ["inspector", "inspector-deep"], "r1")).toBe(false);
    const both = { entries: [entry(), entry({ kind: "inspector-deep" })] };
    expect(isCovered(both, "p1", ["inspector", "inspector-deep"], "r1")).toBe(true);
  });
});

describe("requiredKinds", () => {
  it("検査の仕組みを変える差分_深めの検査も要る", () => {
    expect(requiredKinds(["docs/a.md"])).toEqual(["inspector"]);
    for (const f of ["scripts/a.ts", ".githooks/pre-commit", ".github/workflows/ci.yml", ".claude/settings.json"]) {
      expect(requiredKinds(["docs/a.md", f])).toEqual(["inspector", "inspector-deep"]);
    }
  });
});

describe("isReusable", () => {
  it("バイナリを含む差分_台帳に使わない", () => {
    expect(isReusable("diff --git a/x b/x\n+text\n")).toBe(true);
    expect(isReusable("diff --git a/x.png b/x.png\nBinary files a/x.png and b/x.png differ\n")).toBe(false);
    expect(isReusable("GIT binary patch\nliteral 3\n")).toBe(false);
  });
});

describe("ledger", () => {
  it("同じ差分・同じ種類の記録_置き換える", () => {
    const next = addEntries({ entries: [entry({ verdict: "WARN" })] }, [entry()]);
    expect(next.entries).toEqual([entry()]);
  });

  it("壊れた台帳_空として読む", () => {
    expect(parseLedger("not json")).toEqual({ entries: [] });
    expect(parseLedger('{"entries":[{"patchId":1}]}')).toEqual({ entries: [] });
  });

  it("記録に差分の内容を持たない", () => {
    expect(Object.keys(entry()).sort()).toEqual(["kind", "patchId", "rules", "verdict"]);
  });
});

describe("patchIdOf", () => {
  const diff = (line: string) => `diff --git a/f b/f\n--- a/f\n+++ b/f\n@@ -1 +1 @@\n-old\n+${line}\n`;

  it("同じ内容の差分_同じ ID、違う内容_違う ID、空_null", () => {
    expect(patchIdOf(diff("a"))).toBe(patchIdOf(diff("a")));
    expect(patchIdOf(diff("a"))).not.toBe(patchIdOf(diff("b")));
    expect(patchIdOf("")).toBeNull();
  });
});

// 子プロセスと一時のリポジトリを多く作るので、負荷の高い環境でも 30 秒の既定を超えないよう、上限を広げる
describe("inspection-ledger コマンド", { timeout: 120_000 }, () => {
  const script = fileURLToPath(new URL("../inspection-ledger.ts", import.meta.url));

  function git(cwd: string, ...args: string[]): string {
    const r = spawnSync("git", args, { cwd, encoding: "utf8" });
    if (r.status !== 0) throw new Error(r.stderr);
    return r.stdout.trim();
  }

  function put(dir: string, file: string, text: string) {
    mkdirSync(dirname(join(dir, file)), { recursive: true });
    writeFileSync(join(dir, file), text);
  }

  function makeRepo(): { dir: string; base: string; head: string } {
    const dir = mkdtempSync(join(tmpdir(), "ledger-"));
    git(dir, "init", "-q", "-b", "work");
    git(dir, "config", "user.email", "1+x@users.noreply.github.com");
    git(dir, "config", "user.name", "tester");
    put(dir, "a.txt", "first\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "chore: first");
    const base = git(dir, "rev-parse", "HEAD");
    put(dir, "a.txt", "first\nsecond\n");
    git(dir, "add", "-A");
    git(dir, "commit", "-q", "-m", "chore: second");
    return { dir, base, head: git(dir, "rev-parse", "HEAD") };
  }

  const run = (dir: string, ...args: string[]) =>
    spawnSync("node", [script, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, CI: "1" } });

  it("検査した差分を記録_範囲の検査済みとして出る", () => {
    const { dir, base, head } = makeRepo();
    expect(run(dir, "covered", `${base}..HEAD`).stdout).toBe("");
    expect(run(dir, "record", "HEAD", "inspector", "OK").status).toBe(0);
    expect(run(dir, "covered", `${base}..HEAD`).stdout.trim()).toBe(head);
  });

  it("判定が WARN_検査済みとして出ない", () => {
    const { dir, base } = makeRepo();
    run(dir, "record", "HEAD", "inspector", "WARN");
    expect(run(dir, "covered", `${base}..HEAD`).stdout).toBe("");
  });

  it("基準が変わった_検査済みとして出ない", () => {
    const { dir, base } = makeRepo();
    run(dir, "record", "HEAD", "inspector", "OK");
    put(dir, ".claude/skills/dev-commit/checklist.md", "新しい項目\n");
    expect(run(dir, "covered", `${base}..HEAD`).stdout).toBe("");
    expect(rulesHash(dir, [])).not.toBe(rulesHash(mkdtempSync(join(tmpdir(), "ledger-empty-")), []));
  });

  it("別の作業ツリー_同じ台帳を読める", () => {
    const { dir, base, head } = makeRepo();
    run(dir, "record", "HEAD", "inspector", "OK");
    const wt = join(mkdtempSync(join(tmpdir(), "ledger-wt-")), "wt");
    git(dir, "worktree", "add", "-q", "-b", "other", wt, "HEAD");
    expect(run(wt, "covered", `${base}..HEAD`).stdout.trim()).toBe(head);
  });

  it("作り直したコミット(内容が同じ)_検査済みとして出る", () => {
    const { dir, base } = makeRepo();
    run(dir, "record", "HEAD", "inspector", "OK");
    git(dir, "commit", "-q", "--amend", "-m", "chore: second (reworded)");
    expect(run(dir, "covered", `${base}..HEAD`).stdout.trim()).toBe(git(dir, "rev-parse", "HEAD"));
  });

  it("引数が足りない_使い方を出して終了コード 2", () => {
    expect(run(makeRepo().dir).status).toBe(2);
  });
});
