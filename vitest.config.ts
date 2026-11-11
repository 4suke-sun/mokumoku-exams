import { defineConfig } from "vitest/config";

// ルートの `npm test` は、scripts/ のテストを実行する。各パッケージのテストは、そのパッケージの `test` スクリプトで実行する。
//
// scripts/ のテストには、git や node の子プロセスを多く起動するものがある。全件の実行(`npm run test:all` など)で、
// 並列のワーカーが同時に子プロセスを起動すると、端末の負荷で 1 件が上限を超えて落ちることがある(単独では通る)。
// そのため、上限を既定(5 秒)より十分に長くし、同時に動くワーカーの数を CPU の半分に絞る。
// 値は scripts/vitest-config.test.ts が確かめる。
export const SCRIPTS_TEST_TIMEOUT_MS = 60_000;
export const SCRIPTS_MAX_WORKERS = "50%";

export default defineConfig({
  test: {
    include: ["scripts/**/*.test.ts"],
    testTimeout: SCRIPTS_TEST_TIMEOUT_MS,
    maxWorkers: SCRIPTS_MAX_WORKERS,
  },
});
