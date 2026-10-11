import type { Tokens } from "./types.ts";

export const COOKIE_NAMES = { id: "mokumoku_id", access: "mokumoku_access", refresh: "mokumoku_refresh" } as const;

/** リフレッシュトークンの有効日数(packages/infra の UserPoolClient の設定と同じ。両方のテストで値を固定している) */
export const REFRESH_TOKEN_DAYS = 30;

type CookieOptions = { maxAge: number; secure: boolean };

/** Set-Cookie の 1 行を作る。JavaScript から読めない(HttpOnly)ようにして、別サイトからの送信を避ける(SameSite=Lax)。 */
export function serializeCookie(name: string, value: string, { maxAge, secure }: CookieOptions): string {
  const parts = [`${name}=${encodeURIComponent(value)}`, "Path=/", `Max-Age=${maxAge}`, "HttpOnly", "SameSite=Lax"];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/** 保存するトークンの Set-Cookie 一式。リフレッシュトークンが返らなかったときは、既存のものを触らない。 */
export function sessionCookies(tokens: Tokens, secure: boolean): string[] {
  const cookies = [
    serializeCookie(COOKIE_NAMES.id, tokens.idToken, { maxAge: tokens.expiresIn, secure }),
    serializeCookie(COOKIE_NAMES.access, tokens.accessToken, { maxAge: tokens.expiresIn, secure }),
  ];
  if (tokens.refreshToken) {
    cookies.push(
      serializeCookie(COOKIE_NAMES.refresh, tokens.refreshToken, { maxAge: REFRESH_TOKEN_DAYS * 86400, secure }),
    );
  }
  return cookies;
}

/** 3 つのトークンをすべて破棄する Set-Cookie 一式 */
export function clearedCookies(secure: boolean): string[] {
  return Object.values(COOKIE_NAMES).map((name) => serializeCookie(name, "", { maxAge: 0, secure }));
}

/** Cookie ヘッダーから、トークンの Cookie を取り出す。 */
export function readCookies(header: string | null): { id?: string; access?: string; refresh?: string } {
  const values = new Map<string, string>();
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    try {
      values.set(part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim()));
    } catch {
      // 壊れた値は、ないものとして扱う
    }
  }
  return {
    id: values.get(COOKIE_NAMES.id) || undefined,
    access: values.get(COOKIE_NAMES.access) || undefined,
    refresh: values.get(COOKIE_NAMES.refresh) || undefined,
  };
}

/**
 * リクエストの Cookie ヘッダーの、トークンの値を差し替える(更新した直後のリクエストを、後続の処理に渡すため)。
 * ほかの Cookie はそのまま残す。リフレッシュトークンが返らなかったときは、既存のものを残す。
 */
export function withTokenCookies(header: string | null, tokens: Tokens): string {
  const replaced = new Map<string, string>([
    [COOKIE_NAMES.id, tokens.idToken],
    [COOKIE_NAMES.access, tokens.accessToken],
  ]);
  if (tokens.refreshToken) replaced.set(COOKIE_NAMES.refresh, tokens.refreshToken);
  const kept = (header ?? "")
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part && !replaced.has(part.slice(0, Math.max(0, part.indexOf("="))).trim()));
  return [...kept, ...[...replaced].map(([name, value]) => `${name}=${encodeURIComponent(value)}`)].join("; ");
}

/**
 * JWT の本文(claims)を、署名を確かめずに読む。画面の表示と更新の時刻の判断にだけ使う。
 * 認可の判断には使わない(サーバー側の検証は guard.ts の `authenticate` で行う)。
 */
export function readClaims(jwt: string): { exp?: number; email?: string; groups?: string[] } {
  try {
    const payload = jwt.split(".")[1];
    if (!payload) return {};
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
    return {
      exp: typeof claims.exp === "number" ? claims.exp : undefined,
      email: typeof claims.email === "string" ? claims.email : undefined,
      groups: Array.isArray(claims["cognito:groups"])
        ? claims["cognito:groups"].filter((g): g is string => typeof g === "string")
        : undefined,
    };
  } catch {
    return {};
  }
}

export function isExpired(expSeconds: number | undefined, nowMs: number): boolean {
  return expSeconds === undefined || expSeconds * 1000 <= nowMs;
}
