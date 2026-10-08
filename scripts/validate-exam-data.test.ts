import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./validate-exam-data.ts", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "exam-data-"));
  created.push(dir);
  mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);
  return dir;
}

const run = (...args: string[]) => spawnSync("node", [script, ...args], { cwd: root, encoding: "utf8" });

describe("validate-exam-data", () => {
  it("リポジトリの data/ が、検査を通る", () => {
    const r = run();
    expect(r.status, r.stderr).toBe(0);
  });

  it("exams.json が無いとき、失敗にする", () => {
    const r = run(makeDir({}));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/exams\.json: ファイルがありません/);
  });

  it("JSON として読めないときは、入力の一部を載せずに失敗にする", () => {
    const r = run(makeDir({ "exams.json": '{ "目印XYZ" 壊れた' }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/exams\.json: JSON として読めません/);
    expect(r.stderr).not.toContain("目印XYZ");
  });

  it("フォルダが無いとき、失敗にする", () => {
    const r = run(join(tmpdir(), "no-such-dir-for-exam-data"));
    expect(r.status).toBe(1);
  });

  it("引数が多いとき、成功にしない", () => {
    expect(run("a", "b").status).toBe(2);
  });
});
