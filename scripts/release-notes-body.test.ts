import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./release-notes-body.ts", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));

function run(...args: string[]) {
  return spawnSync("node", [script, ...args], { cwd: root, encoding: "utf8" });
}

describe("release-notes-body", () => {
  it("エントリのある版の本文を出す", () => {
    const r = run("v0.0.1");
    expect(r.status, r.stderr).toBe(0);
    expect(r.stdout).toMatch(/^.+\n\n- 開発: /);
  });

  it("エントリの無い版は、失敗にする", () => {
    const r = run("v99.99.99");
    expect(r.status).toBe(1);
    expect(r.stdout).toBe("");
  });

  it("引数が無い・多いときは、失敗にする", () => {
    expect(run().status).toBe(2);
    expect(run("v0.0.1", "v0.0.2").status).toBe(2);
  });
});
