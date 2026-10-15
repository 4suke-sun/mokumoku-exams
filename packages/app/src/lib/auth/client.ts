import { z } from "zod";
import { requestJson } from "@/lib/api/client.ts";
import { messageFor } from "./messages.ts";

export type PostResult =
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; status: number; code: string; message: string };

/** 認証 API への POST。失敗は、画面に出してよい文言にして返す(通信の失敗も含む)。 */
export async function postJson(path: string, body: unknown): Promise<PostResult> {
  const result = await requestJson(path, { method: "POST", body, schema: AnyObject });
  if (result.ok) return result;
  if (result.status === 0) return { ok: false, status: 0, code: "unavailable", message: messageFor("unavailable") };
  return { ok: false, status: result.status, code: result.code ?? "", message: messageFor(result.code) };
}

// 成功の応答の中身は、呼び出し側が項目ごとに確かめる。読めなければ空にする
const AnyObject = z.record(z.string(), z.unknown()).catch({});

/**
 * ログイン状態。`isAdmin` は、管理者のナビゲーションを出すかどうかの表示のためだけに使う(認可はサーバーが行う)。
 * `owner` は、端末の記録を持ち主ごとに分けるための印(`storage.ts` の `setStorageOwner`)。
 */
export type SessionInfo =
  | { signedIn: false }
  | { signedIn: true; email: string | null; expiresAt: number | null; isAdmin?: boolean; owner?: string | null };

// 応答の中身は、サーバーの形をそのまま使う(JSON として読めれば受け取る)
const SessionSchema = z.custom<SessionInfo>((value) => value !== undefined);

export async function fetchSession(): Promise<SessionInfo | null> {
  const result = await requestJson("/api/auth/session", { schema: SessionSchema });
  return result.ok ? result.data : null;
}
