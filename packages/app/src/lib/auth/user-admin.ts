import {
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";

/**
 * 管理者の画面に出す、利用者の情報。`username` は Cognito のユーザー名(この UserPool では `sub` と同じ値)。
 * メールアドレスは画面に出すためだけに持ち、サーバーのログや操作の記録には入れない。
 */
export type ManagedUser = {
  username: string;
  email: string | null;
  /** Cognito の状態(`CONFIRMED`、`UNCONFIRMED`(確認コードの入力がまだ)、`FORCE_CHANGE_PASSWORD` など) */
  status: string;
  enabled: boolean;
  /** 作成日時(ISO 8601)。取れなければ null */
  createdAt: string | null;
};

/** 画面に見せてよい失敗の種類。原因の詳細(文言)は持たない。 */
export type UserAdminErrorCode = "not-found" | "bad-request" | "limit-exceeded" | "unavailable";

export class UserAdminError extends Error {
  readonly code: UserAdminErrorCode;

  constructor(code: UserAdminErrorCode) {
    super(code);
    this.name = "UserAdminError";
    this.code = code;
  }
}

/** 登録し直しの判断に使う、登録済みのアカウントの状態 */
export type SignUpState = {
  /** Cognito の状態。`UNCONFIRMED` は、確認コードの入力がまだ */
  status: string;
  /** 作成日時(ISO 8601)。取れなければ null */
  createdAt: string | null;
};

/** 確認がまだのアカウントを、別のパスワードの登録で置き換えられるようになるまでの時間(作成から 24 時間) */
export const UNCONFIRMED_REPLACE_AFTER_MS = 24 * 60 * 60 * 1000;

/** 確認がまだで、作成から `UNCONFIRMED_REPLACE_AFTER_MS` たったか。作成日時が取れなければ、たっていないものとする */
export function isStaleUnconfirmed(state: SignUpState, now: number): boolean {
  if (state.status !== "UNCONFIRMED" || state.createdAt === null) return false;
  const created = Date.parse(state.createdAt);
  return !Number.isNaN(created) && now - created >= UNCONFIRMED_REPLACE_AFTER_MS;
}

/** 利用者の管理の境界。本番は Cognito の管理 API、手元の開発とテストでは差し替える。 */
export interface UserAdmin {
  /** UserPool の利用者を返す(順不同) */
  listUsers(): Promise<ManagedUser[]>;
  /** 無効にする。無効にした利用者は、以降ログインもトークンの更新もできない */
  disableUser(username: string): Promise<void>;
  /** メールアドレスのアカウントの状態と作成日時。なければ null(登録の API が、登録し直しを見分けるために使う) */
  getSignUpState(email: string): Promise<SignUpState | null>;
  /**
   * 確認がまだで、作成から 24 時間たったアカウントだけを消す。消す直前に状態を読み直し、確認済みのアカウントは決して消さない。
   * 消したら true、条件に合わず消さなかったら false。
   */
  deleteStaleUnconfirmed(email: string, now: number): Promise<boolean>;
}

/** SDK のクライアントの、使う操作だけ(テストで差し替える) */
export type CommandSender = { send(command: unknown): Promise<unknown> };

type Options = { region: string; userPoolId: string; client?: CommandSender };

// 例外の種類から、画面に見せる失敗の種類への対応。ここにないものは「利用できない」として扱う
const ERROR_CODES: Record<string, UserAdminErrorCode> = {
  UserNotFoundException: "not-found",
  InvalidParameterException: "bad-request",
  LimitExceededException: "limit-exceeded",
  TooManyRequestsException: "limit-exceeded",
};

/** 1 回の一覧で取る数(Cognito の上限)と、たどるページの上限 */
const PAGE_SIZE = 60;
const MAX_PAGES = 20;

type UserRecord = {
  Username?: string;
  Attributes?: { Name?: string; Value?: string }[];
  UserCreateDate?: Date;
  Enabled?: boolean;
  UserStatus?: string;
};

const statusOf = (value: unknown) => (typeof value === "string" ? value : "UNKNOWN");

function createdAtOf(value: unknown): string | null {
  return value instanceof Date && !Number.isNaN(value.getTime()) ? value.toISOString() : null;
}

function toManagedUser(user: UserRecord): ManagedUser | null {
  if (typeof user.Username !== "string") return null;
  const email = user.Attributes?.find((a) => a.Name === "email")?.Value;
  return {
    username: user.Username,
    email: typeof email === "string" ? email : null,
    status: statusOf(user.UserStatus),
    enabled: user.Enabled !== false,
    createdAt: createdAtOf(user.UserCreateDate),
  };
}

/**
 * Cognito の管理 API(IAM の署名が要る操作)を、SDK で呼ぶ。権限は、アプリの Lambda に、この UserPool に限って与える。
 * 失敗の文言や入力の値は、例外にもログにも残さない(種類だけを見る)。
 */
export function createCognitoUserAdmin(options: Options): UserAdmin {
  const client: CommandSender = options.client ?? new CognitoIdentityProviderClient({ region: options.region });
  const { userPoolId } = options;

  async function call<T>(command: unknown): Promise<T> {
    try {
      return (await client.send(command)) as T;
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      throw new UserAdminError(ERROR_CODES[name] ?? "unavailable");
    }
  }

  async function getSignUpState(email: string): Promise<SignUpState | null> {
    try {
      const output = await call<{ UserStatus?: string; UserCreateDate?: Date }>(
        new AdminGetUserCommand({ UserPoolId: userPoolId, Username: email }),
      );
      return { status: statusOf(output.UserStatus), createdAt: createdAtOf(output.UserCreateDate) };
    } catch (error) {
      if (error instanceof UserAdminError && error.code === "not-found") return null;
      throw error;
    }
  }

  return {
    async listUsers() {
      const users: ManagedUser[] = [];
      let token: string | undefined;
      for (let page = 0; page < MAX_PAGES; page++) {
        const output = await call<{ Users?: UserRecord[]; PaginationToken?: string }>(
          new ListUsersCommand({
            UserPoolId: userPoolId,
            Limit: PAGE_SIZE,
            AttributesToGet: ["email"],
            ...(token ? { PaginationToken: token } : {}),
          }),
        );
        for (const user of output.Users ?? []) {
          const managed = toManagedUser(user);
          if (managed) users.push(managed);
        }
        token = output.PaginationToken;
        if (!token) break;
      }
      return users;
    },

    async disableUser(username) {
      await call(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: username }));
    },

    getSignUpState,

    async deleteStaleUnconfirmed(email, now) {
      // 確認済みのアカウントを消さないよう、消す直前に状態を読み直す
      const state = await getSignUpState(email);
      if (!state || !isStaleUnconfirmed(state, now)) return false;
      await call(new AdminDeleteUserCommand({ UserPoolId: userPoolId, Username: email }));
      return true;
    },
  };
}
