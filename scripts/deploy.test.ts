import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./deploy.ts", import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

describe("deploy", () => {
  it("引数がない_使い方を示して終了コード2で終わる", () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("使い方");
  });

  it("版がvX.Y.Zの形でない_終了コード2で終わる", () => {
    expect(run(["90"]).status).toBe(2);
  });

  it("未知のオプション_終了コード2で終わる", () => {
    expect(run(["v0.90.0", "--force"]).status).toBe(2);
  });
});
