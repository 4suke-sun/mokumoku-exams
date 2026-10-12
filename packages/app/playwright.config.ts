import { defineConfig } from "@playwright/test";

// 開発サーバーを、AWS に接続しない代替の認証(AUTH_FAKE=1)で起動して通す。本番のビルド(NODE_ENV=production)では代替の認証は無効。
const PORT = 3100;

export default defineConfig({
  testDir: "./e2e",
  // 開発サーバーは、初めて開く画面を、その場でビルドする。待ち時間を長めにとる
  timeout: 120_000,
  expect: { timeout: 45_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    locale: "ja-JP",
  },
  projects: [{ name: "chromium", use: { browserName: "chromium" } }],
  webServer: {
    command: `npx next dev --webpack --port ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    env: { AUTH_FAKE: "1" },
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
