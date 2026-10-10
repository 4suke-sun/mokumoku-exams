import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// 画面部品のテストで、1 件ごとに描画を片付ける(Node 環境のテストでは何もしない)
afterEach(() => {
  cleanup();
});
