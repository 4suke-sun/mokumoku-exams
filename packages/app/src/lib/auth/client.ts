import { messageFor } from "./messages.ts";

export type PostResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

/** 認証 API への POST。失敗は、画面に出してよい文言にして返す(通信の失敗も含む)。 */
export async function postJson(path: string, body: unknown): Promise<PostResult> {
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { ok: true, data };
    return { ok: false, status: response.status, code: String(data.error ?? ""), message: messageFor(data.error) };
  } catch {
    return { ok: false, status: 0, code: "unavailable", message: messageFor("unavailable") };
  }
}

/** ログイン状態。`isAdmin` は、管理者のナビゲーションを出すかどうかの表示のためだけに使う(認可はサーバーが行う)。 */
export type SessionInfo =
  | { signedIn: false }
  | { signedIn: true; email: string | null; expiresAt: number | null; isAdmin?: boolean };

export async function fetchSession(): Promise<SessionInfo | null> {
  try {
    const response = await fetch("/api/auth/session", { cache: "no-store" });
    if (!response.ok) return null;
    return (await response.json()) as SessionInfo;
  } catch {
    return null;
  }
}
