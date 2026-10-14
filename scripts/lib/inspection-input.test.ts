import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../prepare-inspection.ts", import.meta.url));
const NOREPLY = "1+x@users.noreply.github.com";

function git(cwd: string, ...args: string[]): string {
  const r = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout.trim();
}

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "inspect-"));
  git(dir, "init", "-q", "-b", "work");
  git(dir, "config", "user.email", NOREPLY);
  git(dir, "config", "user.name", "tester");
  writeFileSync(join(dir, "a.txt"), "first\n");
  git(dir, "add", "-A");
  git(dir, "commit", "-q", "-m", "chore: first");
  writeFileSync(join(dir, "a.txt"), "first\nsecond\n");
  git(dir, "add", "-A");
  return dir;
}

const run = (dir: string, ...args: string[]) =>
  spawnSync("node", [script, ...args], { cwd: dir, encoding: "utf8", env: { ...process.env, CI: "1" } });
const read = (dir: string, name: string) => readFileSync(join(dir, ".drafts/inspect", name), "utf8");

describe("prepare-inspection", () => {
  it("ステージした差分_差分・変更ファイル・作者・ブランチ名を書き出す", () => {
    const dir = makeRepo();
    const r = run(dir, "--cached");
    expect(r.status, r.stderr).toBe(0);
    expect(read(dir, "diff.patch")).toContain("+second");
    expect(read(dir, "files.txt")).toContain("a.txt");
    expect(read(dir, "commits.txt")).toContain(NOREPLY);
    expect(read(dir, "branch.txt")).toBe("work\n");
  });

  it("範囲の指定_範囲の全コミットの差分とメッセージを書き出す", () => {
    const dir = makeRepo();
    git(dir, "commit", "-q", "-m", "chore: second");
    const r = run(dir, "--range", "HEAD~1..HEAD");
    expect(r.status, r.stderr).toBe(0);
    expect(read(dir, "diff.patch")).toContain("+second");
    expect(read(dir, "commits.txt")).toContain("chore: second");
    expect(read(dir, "commits.txt")).not.toContain("chore: first");
  });

  it("拒否リストがない_照合できなかったと報告させる印を書く", () => {
    const dir = makeRepo();
    run(dir, "--cached");
    expect(read(dir, "denylist.txt")).toContain("なし");
  });

  it("拒否リストがある_置き場のパスを書き、語は書かない", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, ".pr-secrets-denylist"), "secret-term\n");
    run(dir, "--cached");
    const text = read(dir, "denylist.txt");
    expect(text).toContain(".pr-secrets-denylist");
    expect(text).not.toContain("secret-term");
  });

  it("再実行_前回のファイルを消して書き直し、--clean で消える", () => {
    const dir = makeRepo();
    writeFileSync(join(dir, ".drafts-stale"), "x");
    run(dir, "--cached");
    run(dir, "--cached");
    expect(existsSync(join(dir, ".drafts/inspect/diff.patch"))).toBe(true);
    expect(run(dir, "--clean").status).toBe(0);
    expect(existsSync(join(dir, ".drafts/inspect"))).toBe(false);
  });

  it("引数がない_使い方を出して終了コード 2", () => {
    expect(run(makeRepo()).status).toBe(2);
  });
});
