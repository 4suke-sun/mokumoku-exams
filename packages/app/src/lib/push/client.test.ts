import { describe, expect, it } from "vitest";
import { base64UrlToBytes } from "./client.ts";

describe("base64UrlToBytes", () => {
  it("base64url(埋め草なし)_元のバイト列に戻す", () => {
    const bytes = Uint8Array.from([0, 1, 250, 251, 252, 253, 254, 255, 62, 63]);
    const encoded = Buffer.from(bytes).toString("base64url");
    expect(encoded).toMatch(/[-_]/);
    expect([...base64UrlToBytes(encoded)]).toEqual([...bytes]);
  });

  it("VAPID の公開鍵の長さ(87 文字)_65 バイトになる", () => {
    const key = Buffer.from(new Uint8Array(65).fill(4)).toString("base64url");
    expect(key).toHaveLength(87);
    expect(base64UrlToBytes(key)).toHaveLength(65);
  });
});
