import { z } from "zod";
import { requestJson } from "@/lib/api/client.ts";
import type { AdminError, AdminUserRow } from "./handlers.ts";

// 画面に出す文言。原因の詳細は、サーバーから返らない
const MESSAGES: Record<AdminError, string> = {
  "bad-request": "入力を確かめてください。",
  "self-disable": "自分のアカウントは無効にできません。",
  forbidden: "この操作は、管理者だけができます。ログインし直してください。",
  "not-found": "対象のユーザーが見つかりません。一覧を読み直してください。",
  "too-large": "入力が長すぎます。",
  "limit-exceeded": "操作の回数が多すぎます。しばらく待ってから、もう一度お試しください。",
  unavailable: "いま処理できません。しばらくしてから、もう一度お試しください。",
};

export function adminMessageFor(code: unknown): string {
  return typeof code === "string" && code in MESSAGES ? MESSAGES[code as AdminError] : MESSAGES.unavailable;
}

/** 一覧に出す状態。無効にした利用者は、Cognito の状態によらず「無効」 */
export function statusLabel(user: Pick<AdminUserRow, "enabled" | "status">): string {
  if (!user.enabled) return "無効";
  if (user.status === "CONFIRMED") return "有効";
  // 登録のあと、確認コードの入力がまだ(ログインできない)
  if (user.status === "UNCONFIRMED") return "確認待ち";
  // 招待済みで未使用の利用者(仮パスワードでの初回ログインの前)
  if (user.status === "FORCE_CHANGE_PASSWORD") return "招待中(初回ログイン前)";
  if (user.status === "RESET_REQUIRED") return "パスワードの再設定が必要";
  return "その他";
}

/** 作成日を、日付だけで出す(取れなければ「-」) */
export function createdLabel(createdAt: string | null): string {
  return createdAt ? createdAt.slice(0, 10) : "-";
}

export type AdminResult<T> = { ok: true; data: T } | { ok: false; message: string };

// 成功の応答の中身は、サーバーの型(AdminUserRow など)をそのまま使う。読めなければ空にする
const AnyObject = z.record(z.string(), z.unknown()).catch({});

async function request<T>(path: string, body?: unknown): Promise<AdminResult<T>> {
  const result = await requestJson(
    path,
    body === undefined ? { schema: AnyObject } : { method: "POST", body, schema: AnyObject },
  );
  return result.ok ? { ok: true, data: result.data as T } : { ok: false, message: adminMessageFor(result.code) };
}

const postJson = <T>(path: string, body: unknown) => request<T>(path, body);

export const fetchUsers = () => request<{ users: AdminUserRow[] }>("/api/admin/users");
export const disableUser = (username: string) => postJson<{ status: string }>("/api/admin/users/disable", { username });
