import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-lessons.ts", import.meta.url));
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const lesson = (title: string, rule = "規則。") =>
  `# ${title}\n\n## 注意すること\n\n${rule}\n\n## 理由\n\n理由。\n\n## 対処\n\n対処。\n`;

/** docs/app/lessons/ に files を置いた一時フォルダを作る。 */
function makeCwd(files: Record<string, string>, index = "") {
  const dir = mkdtempSync(join(tmpdir(), "lessons-"));
  created.push(dir);
  const lessons = join(dir, "docs", "app", "lessons");
  mkdirSync(lessons, { recursive: true });
  writeFileSync(join(lessons, "README.md"), `# 学び\n\n<!-- lessons:start -->\n${index}\n<!-- lessons:end -->\n`);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(lessons, name), text);
  return dir;
}

function run(cwd: string, ...args: string[]) {
  return spawnSync("node", [script, ...args], { cwd, encoding: "utf8" });
}

describe("check-lessons", () => {
  it("--write で一覧を更新すると、通る", () => {
    const cwd = makeCwd({ "0001-a.md": lesson("題 A") });
    expect(run(cwd).status).toBe(1); // 一覧が最新ではない
    const r = run(cwd, "--write");
    expect(r.status, r.stderr).toBe(0);
    expect(readFileSync(join(cwd, "docs/app/lessons/README.md"), "utf8")).toContain("- [0001 題 A](./0001-a.md)");
    expect(run(cwd).status).toBe(0);
  });

  it("出来事を語る書き方を、本文を載せずに止める", () => {
    const cwd = makeCwd(
      { "0001-a.md": lesson("題", "先日、目印ABCの値を出してしまった。") },
      "- [0001 題](./0001-a.md)",
    );
    const r = run(cwd);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/出来事を語る書き方/);
    expect(r.stderr).not.toContain("目印ABC");
  });

  it("機密らしい内容を止める", () => {
    const key = `AK${"IA"}${"A".repeat(16)}`;
    const cwd = makeCwd({ "0001-a.md": lesson("題", `キーは ${key} である。`) }, "- [0001 題](./0001-a.md)");
    const r = run(cwd);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/アクセスキー ID/);
    expect(r.stderr).not.toContain(key);
  });

  it("フォルダが無いときは、失敗にする", () => {
    const dir = mkdtempSync(join(tmpdir(), "lessons-"));
    created.push(dir);
    expect(run(dir).status).toBe(1);
  });

  it("引数が不正なときは、成功にしない", () => {
    const cwd = makeCwd({});
    expect(run(cwd, "--wirte").status).toBe(2);
    expect(run(cwd, "--write", "x").status).toBe(2);
  });
});
