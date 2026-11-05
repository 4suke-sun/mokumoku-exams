import type { AuthErrorCode } from "./types.ts";

/** 確認コードのメールを送れなかったときの文言。上限は Cognito の既定のメールの送信の上限(1 日 50 通、UTC の 9 時に戻る) */
export const SEND_LIMIT_MESSAGE =
  "確認コードを送れませんでした。メールの送信は、サービス全体で 1 日 50 通までで、日本時間の 18 時に数え直します。同じメールアドレスへの送信の回数の上限に達した場合もあります。時間をおいてから、もう一度お試しください。";

/** 登録の画面の、入力の上の注意書き */
export const SEND_LIMIT_NOTE =
  "確認コードのメールは、サービス全体で 1 日 50 通までしか送れません(日本時間の 18 時に数え直します)。届かないときは、18 時を過ぎてからもう一度お試しください。";

// 画面に出す文言。ログインの失敗は、メールアドレスの登録の有無が分からない書き方にする
export const ERROR_MESSAGES: Record<AuthErrorCode, string> = {
  "invalid-credentials": "メールアドレスまたはパスワードが正しくありません。",
  "not-confirmed": "メールアドレスの確認が済んでいません。届いた確認コードを入力してください。",
  "already-exists":
    "このメールアドレスでは登録できません。登録済みなら、ログインかパスワードの再設定をお使いください。",
  "password-policy": "このパスワードは使えません。規則を確認してください。",
  "code-invalid": "確認コードが正しくありません。",
  "code-expired": "確認コードの期限が切れています。もう一度、コードを送ってください。",
  "session-expired": "手続きの有効期限が切れました。最初からやり直してください。",
  "limit-exceeded": "試行の回数が多すぎます。しばらく待ってから、もう一度お試しください。",
  // 送信の上限は、ほかのエラーとまとめず、必ずこの文言で伝える(登録・確認コードの送り直し・パスワードの再設定の画面)
  "send-limit": SEND_LIMIT_MESSAGE,
  unavailable: "いま処理できません。しばらくしてから、もう一度お試しください。",
};

export const FALLBACK_MESSAGE = ERROR_MESSAGES.unavailable;

export function messageFor(code: unknown): string {
  return typeof code === "string" && code in ERROR_MESSAGES ? ERROR_MESSAGES[code as AuthErrorCode] : FALLBACK_MESSAGE;
}
