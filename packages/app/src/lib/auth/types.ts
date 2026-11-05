export type Tokens = {
  idToken: string;
  accessToken: string;
  /** 更新のときは返らないことがある(その場合は、手元のものを使い続ける) */
  refreshToken?: string;
  /** ID トークンとアクセストークンが有効な秒数 */
  expiresIn: number;
};

const AUTH_ERROR_CODE_LIST = [
  "invalid-credentials",
  // 確認コードの入力がまだのアカウント(登録の途中)
  "not-confirmed",
  // 登録に使うメールアドレスが、すでにある(登録し直しの条件に当たらないとき)
  "already-exists",
  "password-policy",
  "code-invalid",
  "code-expired",
  "session-expired",
  "limit-exceeded",
  // メールを送る操作(登録・確認コードの送り直し・パスワードの再設定)で、送信の上限に当たった
  "send-limit",
  "unavailable",
] as const;
const AUTH_ERROR_CODES: ReadonlySet<string> = new Set(AUTH_ERROR_CODE_LIST);

/** 画面に見せてよい失敗の種類。原因の詳細(文言)は持たない。 */
export type AuthErrorCode = (typeof AUTH_ERROR_CODE_LIST)[number];

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
    this.code = code;
  }
}

/**
 * 失敗の種類を取り出す(認証の失敗でなければ null)。手元の開発サーバーでは、代替の認証(globalThis に置く)が、
 * 別に読み込まれた経路のクラスで例外を作ることがあり、`instanceof` では見分けられないため、名前と種類の形でも見る。
 */
export function authErrorCode(error: unknown): AuthErrorCode | null {
  if (error instanceof AuthError) return error.code;
  if (!(error instanceof Error) || error.name !== "AuthError") return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && AUTH_ERROR_CODES.has(code) ? (code as AuthErrorCode) : null;
}

export type SignInResult =
  | { kind: "signed-in"; tokens: Tokens }
  // 招待された人の初回ログイン。新しいパスワードを決めるまで、トークンは出ない
  | { kind: "new-password-required"; session: string; username: string };

/** 認証の境界。本番は Cognito、手元の開発とテストでは差し替える。 */
export interface AuthProvider {
  signIn(email: string, password: string): Promise<SignInResult>;
  completeNewPassword(input: { username: string; session: string; newPassword: string }): Promise<Tokens>;
  /** 登録の有無が分からないよう、存在しない宛先でも成功として扱う */
  requestPasswordReset(email: string): Promise<void>;
  confirmPasswordReset(input: { email: string; code: string; newPassword: string }): Promise<void>;
  refresh(refreshToken: string): Promise<Tokens>;
  changePassword(input: { accessToken: string; previousPassword: string; proposedPassword: string }): Promise<void>;
  /** リフレッシュトークンを無効にする */
  signOut(refreshToken: string): Promise<void>;
  /** 新しく登録し、確認コードをメールで送る。登録済みのメールアドレスは `already-exists` */
  signUp(email: string, password: string): Promise<void>;
  /** 確認コードで、登録を確かめる */
  confirmSignUp(input: { email: string; code: string }): Promise<void>;
  /** 確認コードを送り直す。登録の有無が分からないよう、存在しない宛先でも成功として扱う */
  resendCode(email: string): Promise<void>;
  /** アクセストークンの本人のアカウントを消す */
  deleteAccount(accessToken: string): Promise<void>;
}
