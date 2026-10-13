import http from "node:http";
import net from "node:net";
import { describe, expect, it } from "vitest";

describe("テストでの通信の遮断", () => {
  it("fetch_失敗する", async () => {
    await expect(fetch("https://example.com/")).rejects.toThrow("外部への通信");
  });

  it("ソケットの接続_失敗する", () => {
    expect(() => net.connect(80, "example.com")).toThrow("外部への通信");
  });

  it("http のリクエスト_失敗する", () => {
    expect(() => http.get("http://example.com/")).toThrow("外部への通信");
  });
});
