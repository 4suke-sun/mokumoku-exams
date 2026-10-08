import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./release-notes-body.ts", import.meta.url));

const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** 一時フォルダを作る(実データに依存しない。テストのあとに削除する)。 */
function makeEmptyCwd(): string {
  const dir = mkdtempSync(join(tmpdir(), "release-body-"));
  created.push(dir);
  return dir;
}

/** data/release-notes.json に content を置いた一時フォルダを作る。 */
function makeCwd(content: string): string {
  const dir = makeEmptyCwd();
  mkdirSync(join(dir, "data"));
  writeFileSync(join(dir, "data", "release-notes.json"), content);
  return dir;
}

function run(cwd: string, ...args: string[]) {
  return spawnSync("node", [script, ...args], { cwd, encoding: "utf8" });
}

const valid = JSON.stringify({
  releases: [
    { version: "v0.0.2", date: "2026-10-08", title: "題 2", items: [{ type: "feat", text: "機能の説明" }] },
    { version: "v0.0.1", date: "2026-10-07", title: "題 1", items: [{ type: "dev", text: "開発の説明" }] },
  ],
});

describe("release-notes-body", () => {
  it("指定した版のエントリの本文を出す", () => {
    const r = run(makeCwd(valid), "v0.0.2");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toBe("題 2\n\n- 機能: 機能の説明\n");
  });

  it("エントリの無い版は、何も出さずに失敗にする", () => {
    const r = run(makeCwd(valid), "v9.9.9");
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/対応するエントリがありません/);
  });

  it("JSON として読めないときは、何も出さずに失敗にする", () => {
    const r = run(makeCwd("{ 壊れた"), "v0.0.1");
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/JSON として解析できません/);
  });

  it("構造が不正なときは、何も出さずに失敗にする", () => {
    const broken = JSON.stringify({ releases: [{ version: "v0.0.1", date: "2026-10-07", title: "", items: [] }] });
    const r = run(makeCwd(broken), "v0.0.1");
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/構造が不正です/);
  });

  it("データのファイルが無いときは、何も出さずに失敗にする", () => {
    const r = run(makeEmptyCwd(), "v0.0.1");
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
    expect(r.stderr).toMatch(/読み込めません/);
  });

  it("引数が無い・多いときは、失敗にする", () => {
    const cwd = makeCwd(valid);
    expect(run(cwd).status).toBe(2);
    expect(run(cwd, "v0.0.1", "v0.0.2").status).toBe(2);
  });

  it("本文を含んだまま壊れた JSON でも、エラーメッセージに本文を載せない", () => {
    const marker = "本文のしるしXYZ";
    const r = run(makeCwd(`{ "releases": [ { "text": "${marker}" 壊れた ] }`), "v0.0.1");
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain(marker);
    expect(r.stderr).not.toContain("壊れた");
  });

  it("構造が不正でも、エラーメッセージに本文を載せない", () => {
    const marker = "本文のしるしXYZ";
    const broken = JSON.stringify({
      releases: [{ version: "v0.0.1", date: "2026-10-07", title: marker, items: [{ type: "other", text: marker }] }],
    });
    const r = run(makeCwd(broken), "v0.0.1");
    expect(r.status).toBe(1);
    expect(r.stderr).not.toContain(marker);
  });
});
