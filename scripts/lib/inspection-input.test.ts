import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INSPECT_PART_LINES, splitDiff } from "./inspection-input.ts";

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

  describe("スタンプ", () => {
    const stampOfRun = (stdout: string) => /^スタンプ: ([0-9a-f]+)$/m.exec(stdout)?.[1] ?? "";

    it("書き出し_スタンプを出力と stamp.txt に添える", () => {
      const dir = makeRepo();
      const r = run(dir, "--cached");
      expect(stampOfRun(r.stdout)).toMatch(/^[0-9a-f]{16}$/);
      expect(read(dir, "stamp.txt")).toContain(`スタンプ: ${stampOfRun(r.stdout)}`);
    });

    it("入力が変わっていない_報告のスタンプと一致して通る", () => {
      const dir = makeRepo();
      const stamp = stampOfRun(run(dir, "--cached").stdout);
      expect(run(dir, "--verify", stamp).status).toBe(0);
    });

    it("報告のスタンプが違う_止める", () => {
      const dir = makeRepo();
      run(dir, "--cached");
      const r = run(dir, "--verify", "0000000000000000");
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("スタンプ");
    });

    it("検査のあとにステージの差分が変わった_止める", () => {
      const dir = makeRepo();
      const stamp = stampOfRun(run(dir, "--cached").stdout);
      writeFileSync(join(dir, "a.txt"), "first\nsecond\nthird\n");
      git(dir, "add", "-A");
      const r = run(dir, "--verify", stamp);
      expect(r.status).toBe(1);
      expect(r.stderr).toContain("差分が変わっています");
    });

    it("入力のファイルが書き換わった_止める", () => {
      const dir = makeRepo();
      const stamp = stampOfRun(run(dir, "--cached").stdout);
      writeFileSync(join(dir, ".drafts/inspect/diff.patch"), "古い入力\n");
      expect(run(dir, "--verify", stamp).status).toBe(1);
    });

    it("入力のファイルが欠けた_止める", () => {
      const dir = makeRepo();
      const stamp = stampOfRun(run(dir, "--cached").stdout);
      rmSync(join(dir, ".drafts/inspect/commits.txt"));
      expect(run(dir, "--verify", stamp).status).toBe(1);
    });

    it("入力が片づけられた_止める", () => {
      const dir = makeRepo();
      const stamp = stampOfRun(run(dir, "--cached").stdout);
      run(dir, "--clean");
      expect(run(dir, "--verify", stamp).status).toBe(1);
    });

    it("範囲の入力でコミットが増えた_止める", () => {
      const dir = makeRepo();
      git(dir, "commit", "-q", "-m", "chore: second");
      const stamp = stampOfRun(run(dir, "--range", "HEAD~1..HEAD").stdout);
      expect(run(dir, "--verify", stamp).status).toBe(0);
      writeFileSync(join(dir, "a.txt"), "first\nsecond\nthird\n");
      git(dir, "commit", "-q", "-am", "chore: third");
      expect(run(dir, "--verify", stamp).status).toBe(1);
    });
  });

  describe("分担", () => {
    const fileDiff = (name: string, lines: number) =>
      `diff --git a/${name} b/${name}\n${Array.from({ length: lines - 1 }, (_, i) => `+${i}\n`).join("")}`;

    it("目安以下の差分_1 つのまま返す", () => {
      const diff = fileDiff("a.txt", 10);
      expect(splitDiff(diff, 100)).toEqual([diff]);
    });

    it("目安を超える差分_ファイルの境目で分け、つなぐと元の差分に戻る", () => {
      const diff = fileDiff("a.txt", 60) + fileDiff("b.txt", 60) + fileDiff("c.txt", 30);
      const parts = splitDiff(diff, 100);
      expect(parts.length).toBe(2);
      expect(parts[0]?.startsWith("diff --git a/a.txt")).toBe(true);
      expect(parts[1]?.startsWith("diff --git a/b.txt")).toBe(true);
      expect(parts.join("")).toBe(diff);
    });

    it("マージの差分の見出し(diff --cc)_ファイルの境目として分ける", () => {
      const merged = fileDiff("m.txt", 60).replace("diff --git a/m.txt b/m.txt", "diff --cc m.txt");
      const diff = fileDiff("a.txt", 60) + merged;
      const parts = splitDiff(diff, 100);
      expect(parts.length).toBe(2);
      expect(parts[1]?.startsWith("diff --cc m.txt")).toBe(true);
      expect(parts.join("")).toBe(diff);
    });

    it("1 ファイルが目安を超える_行の範囲で分け、どの分担も目安以下になる", () => {
      const diff = fileDiff("big.txt", 250);
      const parts = splitDiff(diff, 100);
      expect(parts.length).toBe(3);
      for (const part of parts) expect(part.split(/(?<=\n)/).length).toBeLessThanOrEqual(100);
      expect(parts.join("")).toBe(diff);
    });

    it("書き出しで目安を超える_分担ごとのファイルと一覧を書き、分けたファイルが変わると --verify が止める", () => {
      const dir = makeRepo();
      for (const name of ["x.txt", "y.txt"]) {
        writeFileSync(join(dir, name), Array.from({ length: INSPECT_PART_LINES * 0.6 }, (_, i) => `${i}\n`).join(""));
      }
      git(dir, "add", "-A");
      const r = run(dir, "--cached");
      expect(r.status, r.stderr).toBe(0);
      expect(existsSync(join(dir, ".drafts/inspect/diff.patch"))).toBe(false);
      const names = [...read(dir, "parts.txt").matchAll(/diff-\d+\.patch/g)].map((m) => m[0]);
      expect(names.length).toBeGreaterThanOrEqual(2);
      const whole = spawnSync("git", ["diff", "--cached"], { cwd: dir, encoding: "utf8" }).stdout;
      expect(names.map((name) => read(dir, name)).join("")).toBe(whole);
      const stamp = /^スタンプ: ([0-9a-f]+)$/m.exec(r.stdout)?.[1] ?? "";
      expect(run(dir, "--verify", stamp).status).toBe(0);
      writeFileSync(join(dir, ".drafts/inspect/diff-2.patch"), "古い入力\n");
      expect(run(dir, "--verify", stamp).status).toBe(1);
    });
  });
});
