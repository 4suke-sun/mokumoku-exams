import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

// 子プロセスと一時のリポジトリを多く作るので、負荷の高い環境でも、ルートの設定の上限(`SCRIPTS_TEST_TIMEOUT_MS`)を超えないよう、上限を広げる
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

  describe("一覧(manifest.json)", () => {
    const manifestPath = (dir: string) => join(dir, ".drafts", "issues", "manifest.json");
    const readManifest = (dir: string) => JSON.parse(readFileSync(manifestPath(dir), "utf8")) as unknown;
    const repeat = (dir: string) => {
      add(dir, "stale-input", "一回目");
      add(dir, "stale-input", "二回目");
    };
    const writeManifest = (dir: string, text: string) => {
      mkdirSync(join(dir, ".drafts", "issues"), { recursive: true });
      writeFileSync(manifestPath(dir), text);
    };

    it("繰り返しの下書きを作る_一覧に、新規でラベル lessons の項目を足す", () => {
      const dir = makeRepo();
      repeat(dir);
      const result = run(dir, "draft");
      expect(result.status).toBe(0);
      expect(readManifest(dir)).toEqual([{ action: "create", file: "lessons-stale-input.md", labels: ["lessons"] }]);
      expect(result.stdout).toContain("マイルストーンは起票の場で決めます");
    });

    it("一覧にすでに同じ file の項目がある_書き換えず、下書きは作る", () => {
      const dir = makeRepo();
      repeat(dir);
      const existing = [
        { action: "edit", file: "5-other.md", number: 5, milestone: "v0.80.0" },
        { action: "create", file: "lessons-stale-input.md", milestone: "v0.80.0", labels: ["chore"] },
      ];
      writeManifest(dir, `${JSON.stringify(existing, null, 2)}\n`);
      const result = run(dir, "draft");
      expect(result.stdout).toContain("書き換えません");
      expect(readManifest(dir)).toEqual(existing);
      expect(existsSync(join(dir, ".drafts", "issues", "lessons-stale-input.md"))).toBe(true);
    });

    it("一覧に別の項目がある_その項目を残して、末尾に足す", () => {
      const dir = makeRepo();
      repeat(dir);
      const other = { action: "edit", file: "5-other.md", number: 5, milestone: "v0.80.0" };
      writeManifest(dir, JSON.stringify([other]));
      run(dir, "draft");
      expect(readManifest(dir)).toEqual([
        other,
        { action: "create", file: "lessons-stale-input.md", labels: ["lessons"] },
      ]);
    });

    it("下書きがすでにある_一覧を作らず、足さない", () => {
      const dir = makeRepo();
      repeat(dir);
      mkdirSync(join(dir, ".drafts", "issues"), { recursive: true });
      writeFileSync(join(dir, ".drafts", "issues", "lessons-stale-input.md"), "# 人が編集した下書き\n");
      expect(run(dir, "draft").status).toBe(0);
      expect(existsSync(manifestPath(dir))).toBe(false);
    });

    it("一覧を読めない_足さず、終了コード 1 で止め、一覧は変えない", () => {
      const dir = makeRepo();
      repeat(dir);
      writeManifest(dir, "{ broken");
      const result = run(dir, "draft");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("読めない");
      expect(readFileSync(manifestPath(dir), "utf8")).toBe("{ broken");
    });

    it("繰り返しがない_一覧を作らない", () => {
      const dir = makeRepo();
      add(dir, "stale-input", "一回目");
      run(dir, "draft");
      expect(existsSync(manifestPath(dir))).toBe(false);
    });
  });

  describe("closed", () => {
    it("対処済みにした種類がある_キーと行き先を出し、対処していない種類は出さず、受け箱を変えない", () => {
      const dir = makeRepo();
      add(dir, "stale-input", "一回目");
      add(dir, "other-key", "一回目");
      run(dir, "close", "stale-input", "#341");
      const result = run(dir, "closed");
      expect(result.status).toBe(0);
      expect(result.stdout).toMatch(/^stale-input\t#341\t\d{4}-\d{2}-\d{2}$/m);
      expect(result.stdout).not.toContain("other-key");
      expect(run(dir, "list").stdout).toContain("other-key");
    });

    it("対処済みにした種類がない_その旨を出す", () => {
      const dir = makeRepo();
      add(dir, "stale-input", "一回目");
      expect(run(dir, "closed").stdout).toContain("対処済みにした種類はありません");
    });
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
