import { defineConfig } from "vitest/config";

// ルートの `npm test` は、scripts/ のテストを実行する。各パッケージのテストは、そのパッケージの `test` スクリプトで実行する。
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts"],
    // git や node の子プロセスを起動するテストがあるため、既定(5 秒)より長くする
    testTimeout: 30_000,
  },
});
