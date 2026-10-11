import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-release-notes.ts", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));

function run(...args: string[]) {
  return spawnSync("node", [script, ...args], { cwd: root, encoding: "utf8" });
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
