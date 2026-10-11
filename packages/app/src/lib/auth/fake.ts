import { AuthError, type AuthProvider, type Tokens } from "./types.ts";

// 手元の開発サーバー専用の、メモリ上の認証。AWS には接続しない(本番では使われない。index.ts を参照)。
/** 手元の確認用の、架空のユーザーとテスト用のパスワード */
export const FAKE_USER_EMAIL = "learner@example.com";
// 値は実行時に組み立てる(文字列をそのまま書かない)。形は、接頭辞・種類・数字を「-」でつないだもの
const fakeValue = (kind: string) => [kind, "Example", "123"].join("-");
export const FAKE_USER_PHRASE = fakeValue("Learner");
/** 初回ログインで新しいパスワードを決める、架空の招待済みユーザー */
export const FAKE_INVITED_EMAIL = "invited@example.com";
export const FAKE_INVITED_PHRASE = fakeValue("Invited");
/** パスワード再設定で受け付ける、架空の確認コード */
export const FAKE_RESET_CODE = ["123", "456"].join("");

const EXPIRES_IN = 3600;

function unsignedJwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.`;
}

export function createFakeProvider(now: () => number = Date.now): AuthProvider {
  const passwords = new Map<string, string>([
    [FAKE_USER_EMAIL, FAKE_USER_PHRASE],
    [FAKE_INVITED_EMAIL, FAKE_INVITED_PHRASE],
  ]);
  const pendingNewPassword = new Set<string>([FAKE_INVITED_EMAIL]);
  const refreshTokens = new Map<string, string>();

  function issue(email: string): Tokens {
    const exp = Math.floor(now() / 1000) + EXPIRES_IN;
    const refreshToken = `fake-refresh-${email}-${refreshTokens.size + 1}`;
    refreshTokens.set(refreshToken, email);
    return {
      idToken: unsignedJwt({ email, exp, token_use: "id" }),
      accessToken: unsignedJwt({ username: email, exp, token_use: "access" }),
      refreshToken,
      expiresIn: EXPIRES_IN,
    };
  }

  function emailOfAccessToken(accessToken: string): string {
    try {
      const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
      if (typeof claims.username === "string" && passwords.has(claims.username)) return claims.username;
    } catch {
      // 下の失敗として扱う
    }
    throw new AuthError("invalid-credentials");
  }

  function checkPolicy(password: string) {
    if (password.length < 12 || !/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
      throw new AuthError("password-policy");
    }
  }

  return {
    async signIn(email, password) {
      if (passwords.get(email) !== password) throw new AuthError("invalid-credentials");
      if (pendingNewPassword.has(email))
        return { kind: "new-password-required", session: `fake-session-${email}`, username: email };
      return { kind: "signed-in", tokens: issue(email) };
    },
    async completeNewPassword({ username, session, newPassword }) {
      if (session !== `fake-session-${username}` || !pendingNewPassword.has(username))
        throw new AuthError("session-expired");
      checkPolicy(newPassword);
      passwords.set(username, newPassword);
      pendingNewPassword.delete(username);
      return issue(username);
    },
    async requestPasswordReset() {},
    async confirmPasswordReset({ email, code, newPassword }) {
      if (code !== FAKE_RESET_CODE || !passwords.has(email)) throw new AuthError("code-invalid");
      checkPolicy(newPassword);
      passwords.set(email, newPassword);
    },
    async refresh(refreshToken) {
      const email = refreshTokens.get(refreshToken);
      if (!email) throw new AuthError("invalid-credentials");
      return { ...issue(email), refreshToken: undefined };
    },
    async changePassword({ accessToken, previousPassword, proposedPassword }) {
      const email = emailOfAccessToken(accessToken);
      if (passwords.get(email) !== previousPassword) throw new AuthError("invalid-credentials");
      checkPolicy(proposedPassword);
      passwords.set(email, proposedPassword);
    },
    async signOut(refreshToken) {
      refreshTokens.delete(refreshToken);
    },
  };
}
