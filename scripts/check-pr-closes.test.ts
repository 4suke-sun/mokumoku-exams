import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-pr-closes.ts", import.meta.url));
const run = (args: string[]) => spawnSync(process.execPath, [script, ...args], { encoding: "utf8" });

describe("check-pr-closes", () => {
  it("引数がない_使い方を示して終了コード2で終わる", () => {
    const result = run([]);
    expect(result.status).toBe(2);
    expect(result.stderr).toContain("使い方");
  });

  it("未知のオプション_終了コード2で終わる", () => {
    expect(run(["--unknown", "1"]).status).toBe(2);
  });

  it("下書きにClosesがない_gh を使わず終了コード0で終わる", () => {
    const result = run(["--body-file", fileURLToPath(new URL("../CLAUDE.md", import.meta.url))]);
    expect(result.status).toBe(0);
  });
});
