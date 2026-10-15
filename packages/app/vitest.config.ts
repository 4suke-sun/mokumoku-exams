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
    // `npm run test:coverage` で測る。値を見るだけで、しきい値は設けない(CONTRIBUTING.md の「テスト」)
    coverage: {
      provider: "v8",
      include: ["src/**/*.{ts,tsx}"],
      exclude: ["src/**/*.test.{ts,tsx}", "src/test/**"],
      reporter: ["text-summary", "json-summary"],
    },
  },
});
