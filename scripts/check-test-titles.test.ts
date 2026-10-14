import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-test-titles.ts", import.meta.url));

function run(args: string[]) {
  return spawnSync(process.execPath, [script, ...args], { encoding: "utf8", env: { ...process.env, CI: "1" } });
}

describe("check-test-titles", () => {
  it("リポジトリの題が基準どおり_終了コード0で終わる", () => {
    expect(run([]).status).toBe(0);
  });

  it("引数が不正_使い方を示して終了コード2で終わる", () => {
    const result = run(["--unknown"]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("使い方");
  });

  it("引数が多すぎる_終了コード2で終わる", () => {
    expect(run(["--write", "--write"]).status).toBe(2);
  });
});
