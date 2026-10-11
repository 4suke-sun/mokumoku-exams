export type Tokens = {
  idToken: string;
  accessToken: string;
  /** 更新のときは返らないことがある(その場合は、手元のものを使い続ける) */
  refreshToken?: string;
  /** ID トークンとアクセストークンが有効な秒数 */
  expiresIn: number;
};

/** 画面に見せてよい失敗の種類。原因の詳細(文言)は持たない。 */
export type AuthErrorCode =
  | "invalid-credentials"
  | "password-policy"
  | "code-invalid"
  | "code-expired"
  | "session-expired"
  | "limit-exceeded"
  | "unavailable";

export class AuthError extends Error {
  readonly code: AuthErrorCode;

  constructor(code: AuthErrorCode) {
    super(code);
    this.name = "AuthError";
    this.code = code;
  }
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
}
