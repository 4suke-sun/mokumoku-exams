import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./check-env-contract.ts", import.meta.url));

describe("check-env-contract", () => {
  it("リポジトリのアプリとスタック_対応していて終了コード0で終わる", () => {
    const result = spawnSync(process.execPath, [script], { encoding: "utf8", env: { ...process.env, CI: "1" } });
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
  });
});
