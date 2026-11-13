import { describe, expect, it } from "vitest";
import config, { SCRIPTS_MAX_WORKERS, SCRIPTS_TEST_TIMEOUT_MS } from "../vitest.config.ts";

describe("scripts のテストの設定", () => {
  it("子プロセスを起動するテストがある_上限が60秒以上で設定に使われる", () => {
    expect(SCRIPTS_TEST_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
    expect(config.test?.testTimeout).toBe(SCRIPTS_TEST_TIMEOUT_MS);
  });

  it("全件の実行で子プロセスが重なる_ワーカーの数がCPUの半分以下に絞られる", () => {
    expect(SCRIPTS_MAX_WORKERS).toBe("50%");
    expect(config.test?.maxWorkers).toBe(SCRIPTS_MAX_WORKERS);
  });
});
