import { describe, expect, it } from "vitest";
import { AuthError, authErrorCode } from "./types.ts";

describe("authErrorCode", () => {
  it("このモジュールの認証の失敗_種類を返す", () => {
    expect(authErrorCode(new AuthError("send-limit"))).toBe("send-limit");
  });

  it("別に読み込まれたクラスの認証の失敗_名前と種類の形で見分けて種類を返す", () => {
    // 手元の開発サーバーで、別の経路が読み込んだ同じクラスから作られた例外の代わり
    const foreign = Object.assign(new Error("not-confirmed"), { name: "AuthError", code: "not-confirmed" });
    expect(authErrorCode(foreign)).toBe("not-confirmed");
  });

  it("名前が違うか種類が未知_認証の失敗として扱わない", () => {
    expect(authErrorCode(Object.assign(new Error("x"), { code: "send-limit" }))).toBeNull();
    expect(authErrorCode(Object.assign(new Error("x"), { name: "AuthError", code: "unknown" }))).toBeNull();
    expect(authErrorCode({ name: "AuthError", code: "send-limit" })).toBeNull();
    expect(authErrorCode(undefined)).toBeNull();
  });
});
