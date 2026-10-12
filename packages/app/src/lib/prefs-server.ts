import { authenticate, type GuardDeps } from "@/lib/auth/guard.ts";
import type { Prefs } from "./prefs.ts";
import { parsePrefsCookie, readPrefsCookieValue } from "./prefs-cookie.ts";

/**
 * このリクエストに適用する設定(サーバーが最初の描画から反映する)。
 * 設定の Cookie があり、持ち主が、サーバー側で検証した ID トークンの利用者と一致するときだけ返す。
 * 未ログイン・Cookie がない・持ち主が違う・検証できないときは null(端末に保存した設定を、画面の側が使う)。
 */
export async function prefsForRequest(cookieHeader: string | null, deps: GuardDeps): Promise<Prefs | null> {
  const value = readPrefsCookieValue(cookieHeader);
  if (!value) return null;
  try {
    const auth = await authenticate(cookieHeader, deps);
    return auth ? parsePrefsCookie(value, auth.user.sub) : null;
  } catch {
    return null;
  }
}
