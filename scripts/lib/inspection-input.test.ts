import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("../prepare-inspection.ts", import.meta.url));
const ledgerScript = fileURLToPath(new URL("../inspection-ledger.ts", import.meta.url));
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

  describe("台帳", () => {
    const record = (dir: string, verdict: string) =>
      spawnSync("node", [ledgerScript, "record", "HEAD", "inspector", verdict], {
        cwd: dir,
        encoding: "utf8",
        env: { ...process.env, CI: "1" },
      });

    function repoWithThreeCommits() {
      const dir = makeRepo();
      git(dir, "commit", "-q", "-m", "chore: second");
      const base = git(dir, "rev-parse", "HEAD~1");
      return { dir, base };
    }

    it("検査済みのコミット_差分を省き、メッセージと作者は毎回出す", () => {
      const { dir, base } = repoWithThreeCommits();
      expect(record(dir, "OK").status).toBe(0);
      expect(run(dir, "--range", `${base}..HEAD`).status).toBe(0);
      expect(read(dir, "diff.patch")).toContain("省略");
      expect(read(dir, "diff.patch")).not.toContain("+second");
      expect(read(dir, "covered.txt")).toContain(git(dir, "rev-parse", "--short", "HEAD"));
      expect(read(dir, "commits.txt")).toContain("chore: second");
      expect(read(dir, "commits.txt")).toContain(NOREPLY);
    });

    it("記録のないコミット_差分を出す", () => {
      const { dir, base } = repoWithThreeCommits();
      run(dir, "--range", `${base}..HEAD`);
      expect(read(dir, "diff.patch")).toContain("+second");
      expect(read(dir, "covered.txt")).toContain("なし");
    });

    it("判定が WARN のコミット_差分を出す", () => {
      const { dir, base } = repoWithThreeCommits();
      record(dir, "WARN");
      run(dir, "--range", `${base}..HEAD`);
      expect(read(dir, "diff.patch")).toContain("+second");
    });

    it("検査済みと未検査が混ざる_未検査の差分だけを出す", () => {
      const { dir, base } = repoWithThreeCommits();
      record(dir, "OK");
      writeFileSync(join(dir, "b.txt"), "third\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "chore: third");
      run(dir, "--range", `${base}..HEAD`);
      expect(read(dir, "diff.patch")).toContain("+third");
      expect(read(dir, "diff.patch")).not.toContain("+second");
    });

    it("省くものがない PR_基準との差分をそのまま出す", () => {
      const { dir, base } = repoWithThreeCommits();
      git(dir, "branch", "base-ref", base);
      run(dir, "--pr", "base-ref");
      expect(read(dir, "diff.patch")).toContain("diff --git");
      expect(read(dir, "diff.patch")).toContain("+second");
      expect(read(dir, "diff.patch")).not.toContain("=== コミット");
    });

    it("マージコミットを含む範囲_台帳を使わず、すべて読む", () => {
      const { dir, base } = repoWithThreeCommits();
      record(dir, "OK");
      git(dir, "switch", "-q", "-c", "side", base);
      writeFileSync(join(dir, "side.txt"), "side\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "chore: side");
      git(dir, "switch", "-q", "work");
      git(dir, "merge", "-q", "--no-ff", "-m", "chore: merge", "side");
      run(dir, "--range", `${base}..HEAD`);
      expect(read(dir, "diff.patch")).toContain("+second");
      expect(read(dir, "covered.txt")).toContain("なし");
    });

    it("競合を解消したマージ_解消の内容と変更ファイルを出す", () => {
      const { dir, base } = repoWithThreeCommits();
      git(dir, "switch", "-q", "-c", "side", base);
      writeFileSync(join(dir, "a.txt"), "first\nside-edit\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "chore: side");
      git(dir, "switch", "-q", "work");
      spawnSync("git", ["merge", "--no-ff", "side"], { cwd: dir, encoding: "utf8" });
      writeFileSync(join(dir, "a.txt"), "first\nresolved-line\n");
      git(dir, "add", "-A");
      git(dir, "commit", "-q", "-m", "chore: merge");
      run(dir, "--range", `${base}..HEAD`);
      expect(read(dir, "diff.patch")).toContain("resolved-line");
      expect(read(dir, "files.txt")).toContain("a.txt");
    });

    it("PR の変更ファイル_基準との正味の差分で出す", () => {
      const { dir, base } = repoWithThreeCommits();
      git(dir, "branch", "base-ref", base);
      run(dir, "--pr", "base-ref");
      expect(read(dir, "files.txt")).toMatch(/^M\ta\.txt$/m);
    });

    it("PR の検査_基準との範囲でも台帳を使う", () => {
      const { dir, base } = repoWithThreeCommits();
      git(dir, "branch", "base-ref", base);
      record(dir, "OK");
      run(dir, "--pr", "base-ref");
      expect(read(dir, "diff.patch")).toContain("省略");
    });
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
