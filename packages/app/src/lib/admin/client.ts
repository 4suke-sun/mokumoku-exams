import type { ManagedUser } from "@/lib/auth/user-admin.ts";
import type { AdminError, AdminUserRow } from "./handlers.ts";

// 画面に出す文言。原因の詳細は、サーバーから返らない
const MESSAGES: Record<AdminError, string> = {
  "bad-request": "入力を確かめてください。",
  "self-disable": "自分のアカウントは無効にできません。",
  forbidden: "この操作は、管理者だけができます。ログインし直してください。",
  "not-found": "対象のユーザーが見つかりません。一覧を読み直してください。",
  "already-exists": "このメールアドレスのユーザーは、すでに登録されています。",
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
  if (user.status === "FORCE_CHANGE_PASSWORD") return "招待中(初回ログイン前)";
  if (user.status === "RESET_REQUIRED") return "パスワードの再設定が必要";
  return "その他";
}

/** 作成日を、日付だけで出す(取れなければ「-」) */
export function createdLabel(createdAt: string | null): string {
  return createdAt ? createdAt.slice(0, 10) : "-";
}

export type AdminResult<T> = { ok: true; data: T } | { ok: false; message: string };

async function request<T>(path: string, init?: RequestInit): Promise<AdminResult<T>> {
  try {
    const response = await fetch(path, { cache: "no-store", ...init });
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (response.ok) return { ok: true, data: data as T };
    return { ok: false, message: adminMessageFor(data.error) };
  } catch {
    return { ok: false, message: adminMessageFor("unavailable") };
  }
}

const postJson = <T>(path: string, body: unknown) =>
  request<T>(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const fetchUsers = () => request<{ users: AdminUserRow[] }>("/api/admin/users");
export const inviteUser = (email: string) => postJson<{ user: ManagedUser }>("/api/admin/users", { email });
export const disableUser = (username: string) => postJson<{ status: string }>("/api/admin/users/disable", { username });
