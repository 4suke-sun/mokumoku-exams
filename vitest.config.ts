import { defineConfig } from "vitest/config";

// ルートの `npm test` は、scripts/ のテストを実行する。各パッケージのテストは、そのパッケージの `test` スクリプトで実行する。
export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts"],
  },
});
