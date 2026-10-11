import { describe, expect, it } from "vitest";
import { REFRESH_MARGIN_SECONDS, refreshDelayMs } from "./refresh.ts";
import {
  clearedCookies,
  isExpired,
  REFRESH_TOKEN_DAYS,
  readClaims,
  readCookies,
  serializeCookie,
  sessionCookies,
} from "./session.ts";

function jwt(claims: Record<string, unknown>): string {
  return `h.${Buffer.from(JSON.stringify(claims)).toString("base64url")}.s`;
}

describe("Cookie", () => {
  it("設定する Cookie は_JavaScript から読めず_別サイトからは送られない", () => {
    const cookie = serializeCookie("n", "v w", { maxAge: 10, secure: true });
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Secure");
    expect(cookie).toContain("n=v%20w");
  });

  it("手元の開発(secure でない)では_Secure を付けない", () => {
    expect(serializeCookie("n", "v", { maxAge: 10, secure: false })).not.toContain("Secure");
  });

  it("リフレッシュトークンが返らないとき_その Cookie は設定しない", () => {
    const cookies = sessionCookies({ idToken: "i", accessToken: "a", expiresIn: 60 }, true);
    expect(cookies).toHaveLength(2);
    expect(cookies.some((c) => c.startsWith("mokumoku_refresh="))).toBe(false);
  });

  it("リフレッシュトークンの Cookie は_有効日数と同じ長さ", () => {
    const cookies = sessionCookies({ idToken: "i", accessToken: "a", refreshToken: "r", expiresIn: 60 }, true);
    expect(REFRESH_TOKEN_DAYS).toBe(30);
    expect(cookies.find((c) => c.startsWith("mokumoku_refresh="))).toContain(`Max-Age=${30 * 86400}`);
  });

  it("破棄する Cookie は_3 つとも期限が 0", () => {
    const cleared = clearedCookies(true);
    expect(cleared).toHaveLength(3);
    for (const cookie of cleared) expect(cookie).toContain("Max-Age=0");
  });

  it("Cookie ヘッダーから_トークンを取り出す", () => {
    expect(readCookies("a=1; mokumoku_id=x%20y; mokumoku_refresh=r")).toEqual({
      id: "x y",
      access: undefined,
      refresh: "r",
    });
    expect(readCookies(null)).toEqual({ id: undefined, access: undefined, refresh: undefined });
  });

  it("壊れた Cookie の値は_ないものとして扱う", () => {
    expect(readCookies("mokumoku_id=%E0%A4%A").id).toBeUndefined();
  });
});

describe("トークンの期限", () => {
  it("claims を読む_壊れた値は空", () => {
    expect(readClaims(jwt({ exp: 100, email: "a@example.com" }))).toEqual({ exp: 100, email: "a@example.com" });
    expect(readClaims("broken")).toEqual({});
    expect(readClaims("a.@@@.c")).toEqual({});
  });

  it("更新は_期限の前の余裕を引いた時刻になり_過ぎていれば 0", () => {
    expect(REFRESH_MARGIN_SECONDS).toBe(300);
    expect(refreshDelayMs(1000, 0)).toBe((1000 - 300) * 1000);
    expect(refreshDelayMs(1000, 800_000)).toBe(0);
  });

  it("期限が不明または過去のとき_期限切れ", () => {
    expect(isExpired(undefined, 0)).toBe(true);
    expect(isExpired(10, 10_000)).toBe(true);
    expect(isExpired(11, 10_000)).toBe(false);
  });
});
