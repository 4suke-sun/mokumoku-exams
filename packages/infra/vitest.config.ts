import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["lib/**/*.test.ts"],
    // スタックの合成は、既定(5 秒)より時間がかかることがある
    testTimeout: 60_000,
  },
});
