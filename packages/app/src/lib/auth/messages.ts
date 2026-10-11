import type { AuthErrorCode } from "./types.ts";

// 画面に出す文言。ログインの失敗は、メールアドレスの登録の有無が分からない書き方にする
export const ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  "invalid-credentials": "メールアドレスまたはパスワードが正しくありません。",
  "password-policy": "このパスワードは使えません。規則を確認してください。",
  "code-invalid": "確認コードが正しくありません。",
  "code-expired": "確認コードの期限が切れています。もう一度、コードを送ってください。",
  "session-expired": "手続きの有効期限が切れました。最初からやり直してください。",
  "limit-exceeded": "試行の回数が多すぎます。しばらく待ってから、もう一度お試しください。",
  unavailable: "いま処理できません。しばらくしてから、もう一度お試しください。",
};

export const FALLBACK_MESSAGE = ERROR_MESSAGES.unavailable;

export function messageFor(code: unknown): string {
  return typeof code === "string" && code in ERROR_MESSAGES ? ERROR_MESSAGES[code as AuthErrorCode] : FALLBACK_MESSAGE;
}
