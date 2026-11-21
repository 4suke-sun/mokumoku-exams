import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-release-notes.ts", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));

function run(...args: string[]) {
  return spawnSync("node", [script, ...args], { cwd: root, encoding: "utf8", env: { ...process.env, CI: "1" } });
}

describe("check-release-notes(引数)", () => {
  it("引数の綴りを誤ったときは、成功にしない", () => {
    expect(run("--tga", "v0.1.0").status).not.toBe(0);
    expect(run("v0.1.0").status).not.toBe(0);
  });

  it("--tag に値が無いときは、成功にしない", () => {
    expect(run("--tag").status).not.toBe(0);
  });

  it("エントリの無いタグを指定したときは、失敗にする", () => {
    const r = run("--tag", "v99.99.99");
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/対応するリリースノートのエントリがありません/);
  });

  it("エントリのあるタグを指定したときは、成功にする", () => {
    expect(run("--tag", "v0.1.0").status, run("--tag", "v0.1.0").stderr).toBe(0);
  });
});

describe("check-release-notes(書き方の検査)", () => {
  const created: string[] = [];
  afterEach(() => {
    for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /** data/release-notes.json だけを置いた一時フォルダで、--tag の経路を動かす(実データとタグに依存しない)。 */
  function runTagIn(items: { type: string; text: string }[]) {
    const dir = mkdtempSync(join(tmpdir(), "check-release-notes-"));
    created.push(dir);
    mkdirSync(join(dir, "data"));
    const data = { releases: [{ version: "v99.0.0", date: "2026-10-08", title: "題", items }] };
    writeFileSync(join(dir, "data", "release-notes.json"), JSON.stringify(data));
    return spawnSync("node", [script, "--tag", "v99.0.0"], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, CI: "1" },
    });
  }

  it("--tag の経路で利用者向けの項目に内部の語がある_失敗にする", () => {
    const r = runTagIn([{ type: "feat", text: "`value` を足しました。" }]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/releases\[0\]\.items\[0\]\.text: 利用者向けの項目に、内部の語/);
  });

  it("--tag の経路で開発の項目に内部の語がある_書き方の検査では止めない", () => {
    const r = runTagIn([{ type: "dev", text: "`value` を足しました。" }]);
    expect(r.stderr).not.toMatch(/内部の語/);
  });
});
