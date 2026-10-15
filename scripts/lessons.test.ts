import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = join(dirname(fileURLToPath(import.meta.url)), "lessons.ts");

function makeRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "lessons-"));
  const git = (...args: string[]) => spawnSync("git", args, { cwd: dir, encoding: "utf8" });
  git("init", "-q", "-b", "feat/#1-v0.45.0");
  git("config", "user.email", "1+x@users.noreply.github.com");
  git("config", "user.name", "tester");
  git("commit", "-q", "--allow-empty", "-m", "chore: init");
  return dir;
}

const run = (dir: string, ...args: string[]) => spawnSync("node", [script, ...args], { cwd: dir, encoding: "utf8" });

const add = (dir: string, key: string, what: string) =>
  run(
    dir,
    "add",
    "--key",
    key,
    "--who",
    "subagent",
    "--cause",
    "unchecked",
    "--promote",
    "mechanical",
    "--what",
    what,
    "--should",
    "確かめる",
  );

// 子プロセスと一時のリポジトリを多く作るので、負荷の高い環境でも既定の 30 秒を超えないよう、上限を広げる
describe("lessons コマンド", { timeout: 120_000 }, () => {
  it("同じキーを 2 回足す_繰り返しに出て、下書きを作る", () => {
    const dir = makeRepo();
    expect(add(dir, "stale-input", "一回目").status).toBe(0);
    expect(run(dir, "repeats").stdout).toContain("繰り返しの種類はありません");
    expect(add(dir, "stale-input", "二回目").status).toBe(0);
    expect(run(dir, "repeats").stdout).toContain("stale-input");
    expect(run(dir, "draft").stdout).toContain("下書きを作りました");
    expect(existsSync(join(dir, ".drafts", "issues", "lessons-stale-input.md"))).toBe(true);
  });

  it("下書きがすでにある_上書きしない", () => {
    const dir = makeRepo();
    add(dir, "stale-input", "一回目");
    add(dir, "stale-input", "二回目");
    run(dir, "draft");
    const file = join(dir, ".drafts", "issues", "lessons-stale-input.md");
    writeFileSync(file, "# 人が編集した下書き\n");
    expect(run(dir, "draft").stdout).toContain("上書きしません");
    expect(readFileSync(file, "utf8")).toBe("# 人が編集した下書き\n");
  });

  it("行き先が長すぎる_対処済みにせず、終了コード 1 で止める", () => {
    const dir = makeRepo();
    add(dir, "stale-input", "一回目");
    const result = run(dir, "close", "stale-input", "あ".repeat(201));
    expect(result.status).toBe(1);
    expect(run(dir, "list").stdout).toContain("stale-input");
  });

  it("行き先が正しい_対処済みにして、件数から外れる", () => {
    const dir = makeRepo();
    add(dir, "stale-input", "一回目");
    expect(run(dir, "close", "stale-input", "#341").status).toBe(0);
    expect(run(dir, "list").stdout).toContain("対処していない引っかかりはありません");
  });

  it("不正な項目で足す_項目の名前だけを出し、値を出さない", () => {
    const dir = makeRepo();
    const result = run(dir, "add", "--key", "Bad Key", "--who", "dummy-value-xyz");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("key");
    expect(result.stderr).not.toContain("dummy-value-xyz");
  });
});
