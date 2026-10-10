import { describe, expect, it } from "vitest";
import { isOriginVerified, ORIGIN_VERIFY_HEADER } from "./origin-verify.ts";

describe("isOriginVerified", () => {
  it("手元の開発で合言葉が未設定_確かめずに通す", () => {
    expect(isOriginVerified(undefined, null, false)).toBe(true);
    expect(isOriginVerified("", "anything", false)).toBe(true);
  });

  it("本番で合言葉が未設定_設定漏れとして_すべて断る", () => {
    expect(isOriginVerified(undefined, null, true)).toBe(false);
    expect(isOriginVerified("", "anything", true)).toBe(false);
  });

  it("合言葉が一致する_通す", () => {
    expect(isOriginVerified("dummy-value", "dummy-value", true)).toBe(true);
  });

  it("ヘッダーがない_断る", () => {
    expect(isOriginVerified("dummy-value", null, true)).toBe(false);
  });

  it("合言葉が違う_断る", () => {
    expect(isOriginVerified("dummy-value", "dummy-valuf", true)).toBe(false);
  });

  it("長さが違う_断る", () => {
    expect(isOriginVerified("dummy-value", "dummy", true)).toBe(false);
    expect(isOriginVerified("dummy", "dummy-value", true)).toBe(false);
  });

  it("空のヘッダー_断る", () => {
    expect(isOriginVerified("dummy-value", "", true)).toBe(false);
  });
});

describe("ORIGIN_VERIFY_HEADER", () => {
  it("インフラ側と同じ名前に固定されている", () => {
    expect(ORIGIN_VERIFY_HEADER).toBe("x-origin-verify");
  });
});
