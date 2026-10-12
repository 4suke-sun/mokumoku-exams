import { createHash } from "node:crypto";
import { DEFAULT_PREFS, type Prefs, STYLE_VALUES, THEME_VALUES } from "./prefs.ts";

// 表示の設定を、サーバーが最初の描画から反映するための Cookie。サーバーだけが読む(HttpOnly)。
// 値は `v1.<持ち主の照合>.<テーマ>.<スタイル>.<シャッフル 0 か 1>`。持ち主の照合は、利用者の識別子(`sub`)から作った短い値で、
// 別のアカウントで同じブラウザを使ったとき、前のアカウントの設定を使わないための確認(設定は秘密の情報ではないので、署名はしない)。

export const PREFS_COOKIE = "mokumoku_prefs";
const VERSION = "v1";
/** 1 年 */
const MAX_AGE_SECONDS = 365 * 24 * 60 * 60;

/** 持ち主の照合。`sub` の SHA-256 の先頭 16 文字(識別子そのものは、Cookie に入れない) */
export function ownerTag(sub: string): string {
  return createHash("sha256").update(sub).digest("hex").slice(0, 16);
}

export function prefsCookieValue(sub: string, prefs: Prefs): string {
  return [VERSION, ownerTag(sub), prefs.theme, prefs.style, prefs.shuffleChoices ? "1" : "0"].join(".");
}

/** Set-Cookie の 1 行 */
export function prefsSetCookie(sub: string, prefs: Prefs, secure: boolean): string {
  const parts = [
    `${PREFS_COOKIE}=${prefsCookieValue(sub, prefs)}`,
    "Path=/",
    `Max-Age=${MAX_AGE_SECONDS}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

/**
 * Cookie の値を読む。形が違う・持ち主が違う・知らない値のときは null(設定を使わない)。
 * `sub` は、サーバー側で検証した ID トークンのもの。
 */
export function parsePrefsCookie(value: string | undefined, sub: string): Prefs | null {
  if (!value) return null;
  const [version, owner, theme, style, shuffle, ...rest] = value.split(".");
  if (version !== VERSION || rest.length > 0 || owner !== ownerTag(sub)) return null;
  if (!THEME_VALUES.includes(theme as Prefs["theme"]) || !STYLE_VALUES.includes(style as Prefs["style"])) return null;
  if (shuffle !== "0" && shuffle !== "1") return null;
  return { theme: theme as Prefs["theme"], style: style as Prefs["style"], shuffleChoices: shuffle === "1" };
}

/** Cookie ヘッダーから、設定の Cookie の値を取り出す */
export function readPrefsCookieValue(header: string | null): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    if (part.slice(0, index).trim() === PREFS_COOKIE) return part.slice(index + 1).trim();
  }
  return undefined;
}

export { DEFAULT_PREFS };
