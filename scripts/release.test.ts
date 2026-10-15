import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./release.ts", import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

describe("release", () => {
  it("引数がない_使い方を示して終了コード2で終わる", () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("使い方");
  });

  it("PRの番号が数字でない_終了コード2で終わる", () => {
    expect(run(["abc"]).status).toBe(2);
  });

  it("未知のオプション_終了コード2で終わる", () => {
    expect(run(["1", "--merge"]).status).toBe(2);
  });
});
