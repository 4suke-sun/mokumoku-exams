import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/test-setup.ts"],
    // node の子プロセスを起動するテストがあるため、既定(5 秒)より長くする(ルートの設定と同じ)
    testTimeout: 30_000,
  },
});
