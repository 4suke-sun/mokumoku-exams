import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // アプリ内の `@/` を、テストでも同じように解決する
    alias: { "@": resolve(import.meta.dirname, "src") },
  },
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    // 既定は Node。画面部品のテストは、ファイルの先頭に `// @vitest-environment jsdom` を書いて切り替える
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
  },
});
