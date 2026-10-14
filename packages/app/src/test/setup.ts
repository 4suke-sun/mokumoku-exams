import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach } from "vitest";
import { setStorageOwner } from "../lib/storage.ts";

/** テストの持ち主の印(`sub` の SHA-256 の先頭 16 文字と同じ形) */
export const TEST_OWNER = "0123456789abcdef";

// 端末の記録は、持ち主の印が取れてから読み書きする。テストでは、ログイン中の 1 人の利用者として始める
beforeEach(() => {
  setStorageOwner(TEST_OWNER);
});

// 画面部品のテストで、1 件ごとに描画を片付ける(Node 環境のテストでは何もしない)
afterEach(() => {
  cleanup();
});
