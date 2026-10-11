import { ADMIN_GROUP } from "./admin.ts";
import { AuthError, type AuthProvider, type Tokens } from "./types.ts";
import { type ManagedUser, type UserAdmin, UserAdminError } from "./user-admin.ts";
import { SUB_PATTERN, type TokenVerifier } from "./verify.ts";

// 手元の開発サーバー専用の、メモリ上の認証。AWS には接続しない(本番では使われない。index.ts を参照)。
/** 手元の確認用の、架空のユーザーとテスト用のパスワード */
export const FAKE_USER_EMAIL = "learner@example.com";
// 値は実行時に組み立てる(文字列をそのまま書かない)。形は、接頭辞・種類・数字を「-」でつないだもの
const fakeValue = (kind: string) => [kind, "Example", "123"].join("-");
export const FAKE_USER_PHRASE = fakeValue("Learner");
/** 初回ログインで新しいパスワードを決める、架空の招待済みユーザー */
export const FAKE_INVITED_EMAIL = "invited@example.com";
export const FAKE_INVITED_PHRASE = fakeValue("Invited");
/** 管理者のグループに入っている、架空のユーザー */
export const FAKE_ADMIN_EMAIL = "admin@example.com";
export const FAKE_ADMIN_PHRASE = fakeValue("Admin");
/** パスワード再設定で受け付ける、架空の確認コード */
export const FAKE_RESET_CODE = ["123", "456"].join("");

const EXPIRES_IN = 3600;

/** 架空のユーザーごとの、決まった `sub`(英数字と `-` `_` だけ。履歴のキーに使える形) */
export function fakeSub(email: string): string {
  return `fake-${Buffer.from(email).toString("base64url")}`;
}

function unsignedJwt(claims: Record<string, unknown>): string {
  const part = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none" })}.${part(claims)}.`;
}

type FakeAccount = {
  password: string;
  groups: string[];
  /** 招待のあと、初回ログインで新しいパスワードを決める前 */
  pendingNewPassword: boolean;
  enabled: boolean;
  createdAt: number;
};

/** 代替の認証と、代替の利用者の管理が共有する、メモリ上の利用者の一覧(メールアドレスごと) */
export type FakeDirectory = Map<string, FakeAccount>;

export function createFakeDirectory(now: () => number = Date.now): FakeDirectory {
  const account = (password: string, extra: Partial<FakeAccount> = {}): FakeAccount => ({
    password,
    groups: [],
    pendingNewPassword: false,
    enabled: true,
    createdAt: now(),
    ...extra,
  });
  return new Map([
    [FAKE_USER_EMAIL, account(FAKE_USER_PHRASE)],
    [FAKE_INVITED_EMAIL, account(FAKE_INVITED_PHRASE, { pendingNewPassword: true })],
    [FAKE_ADMIN_EMAIL, account(FAKE_ADMIN_PHRASE, { groups: [ADMIN_GROUP] })],
  ]);
}

export function createFakeProvider(
  now: () => number = Date.now,
  directory: FakeDirectory = createFakeDirectory(now),
): AuthProvider {
  const refreshTokens = new Map<string, string>();

  function issue(email: string): Tokens {
    const exp = Math.floor(now() / 1000) + EXPIRES_IN;
    const refreshToken = `fake-refresh-${email}-${refreshTokens.size + 1}`;
    refreshTokens.set(refreshToken, email);
    const groups = directory.get(email)?.groups ?? [];
    return {
      idToken: unsignedJwt({
        sub: fakeSub(email),
        email,
        exp,
        token_use: "id",
        ...(groups.length > 0 ? { "cognito:groups": groups } : {}),
      }),
      accessToken: unsignedJwt({ sub: fakeSub(email), username: email, exp, token_use: "access" }),
      refreshToken,
      expiresIn: EXPIRES_IN,
    };
  }

  /** 有効な(無効にされていない)利用者 */
  const activeAccount = (email: string) => {
    const account = directory.get(email);
    return account?.enabled ? account : undefined;
  };

  function emailOfAccessToken(accessToken: string): string {
    try {
      const claims = JSON.parse(Buffer.from(accessToken.split(".")[1] ?? "", "base64url").toString("utf8"));
      if (typeof claims.username === "string" && activeAccount(claims.username)) return claims.username;
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
      // 無効にされた利用者も、Cognito と同じく、認証の失敗として扱う
      const account = activeAccount(email);
      if (account?.password !== password) throw new AuthError("invalid-credentials");
      if (account.pendingNewPassword)
        return { kind: "new-password-required", session: `fake-session-${email}`, username: email };
      return { kind: "signed-in", tokens: issue(email) };
    },
    async completeNewPassword({ username, session, newPassword }) {
      const account = activeAccount(username);
      if (session !== `fake-session-${username}` || !account?.pendingNewPassword)
        throw new AuthError("session-expired");
      checkPolicy(newPassword);
      account.password = newPassword;
      account.pendingNewPassword = false;
      return issue(username);
    },
    async requestPasswordReset() {},
    async confirmPasswordReset({ email, code, newPassword }) {
      const account = activeAccount(email);
      if (code !== FAKE_RESET_CODE || !account) throw new AuthError("code-invalid");
      checkPolicy(newPassword);
      account.password = newPassword;
    },
    async refresh(refreshToken) {
      const email = refreshTokens.get(refreshToken);
      if (!email || !activeAccount(email)) throw new AuthError("invalid-credentials");
      return { ...issue(email), refreshToken: undefined };
    },
    async changePassword({ accessToken, previousPassword, proposedPassword }) {
      const email = emailOfAccessToken(accessToken);
      const account = activeAccount(email);
      if (account?.password !== previousPassword) throw new AuthError("invalid-credentials");
      checkPolicy(proposedPassword);
      account.password = proposedPassword;
    },
    async signOut(refreshToken) {
      refreshTokens.delete(refreshToken);
    },
  };
}

/**
 * 手元の開発とテスト専用の、利用者の管理。代替の認証と同じ一覧を操作する(本番では使われない。index.ts を参照)。
 * 招待した利用者は、仮パスワード `FAKE_INVITED_PHRASE` でログインすると、新しいパスワードを決める入力に進む。
 */
export function createFakeUserAdmin(directory: FakeDirectory, now: () => number = Date.now): UserAdmin {
  const toManaged = (email: string, account: FakeAccount): ManagedUser => ({
    username: fakeSub(email),
    email,
    status: account.pendingNewPassword ? "FORCE_CHANGE_PASSWORD" : "CONFIRMED",
    enabled: account.enabled,
    createdAt: new Date(account.createdAt).toISOString(),
  });
  return {
    async listUsers() {
      return [...directory].map(([email, account]) => toManaged(email, account));
    },
    async inviteUser(email) {
      if (directory.has(email)) throw new UserAdminError("already-exists");
      const account: FakeAccount = {
        password: FAKE_INVITED_PHRASE,
        groups: [],
        pendingNewPassword: true,
        enabled: true,
        createdAt: now(),
      };
      directory.set(email, account);
      return toManaged(email, account);
    },
    async disableUser(username) {
      const found = [...directory].find(([email]) => fakeSub(email) === username);
      if (!found) throw new UserAdminError("not-found");
      found[1].enabled = false;
    },
  };
}

/**
 * 手元の開発とテスト専用の検証。署名のないトークン(上の代替認証が発行したもの)を受け付けるため、
 * 本番では使えない(使う側の index.ts が、本番の設定では選ばない)。
 */
export function createFakeVerifier(now: () => number = Date.now): TokenVerifier {
  return {
    async verifyIdToken(token) {
      try {
        const [header, payload] = token.split(".");
        if (!header || !payload) return null;
        if ((JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: unknown }).alg !== "none")
          return null;
        const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<string, unknown>;
        if (claims.token_use !== "id" || typeof claims.exp !== "number" || claims.exp * 1000 <= now()) return null;
        if (typeof claims.sub !== "string" || !SUB_PATTERN.test(claims.sub)) return null;
        const groups = claims["cognito:groups"];
        return {
          sub: claims.sub,
          email: typeof claims.email === "string" ? claims.email : undefined,
          groups: Array.isArray(groups) ? groups.filter((g): g is string => typeof g === "string") : [],
        };
      } catch {
        return null;
      }
    },
  };
}
