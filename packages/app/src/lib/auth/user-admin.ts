import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { ADMIN_GROUP } from "./admin.ts";

/**
 * 管理者の画面に出す、利用者の情報。`username` は Cognito のユーザー名(この UserPool では `sub` と同じ値)。
 * メールアドレスは画面に出すためだけに持ち、サーバーのログや操作の記録には入れない。
 */
export type ManagedUser = {
  username: string;
  email: string | null;
  /** Cognito の状態(`CONFIRMED`、`FORCE_CHANGE_PASSWORD` など) */
  status: string;
  enabled: boolean;
  /** 作成日時(ISO 8601)。取れなければ null */
  createdAt: string | null;
};

/** 画面に見せてよい失敗の種類。原因の詳細(文言)は持たない。 */
export type UserAdminErrorCode = "already-exists" | "not-found" | "bad-request" | "limit-exceeded" | "unavailable";

export class UserAdminError extends Error {
  readonly code: UserAdminErrorCode;

  constructor(code: UserAdminErrorCode) {
    super(code);
    this.name = "UserAdminError";
    this.code = code;
  }
}

/** 利用者の管理の境界。本番は Cognito の管理 API、手元の開発とテストでは差し替える。 */
export interface UserAdmin {
  /** UserPool の利用者を返す(順不同) */
  listUsers(): Promise<ManagedUser[]>;
  /** メールアドレスで招待する。Cognito が、仮パスワードつきの招待メールを送る */
  inviteUser(email: string): Promise<ManagedUser>;
  /** 無効にする。無効にした利用者は、以降ログインもトークンの更新もできない */
  disableUser(username: string): Promise<void>;
  /** 管理者のグループに加える。すでに入っているユーザーに行っても、変わらない */
  promoteUser(username: string): Promise<void>;
}

/** SDK のクライアントの、使う操作だけ(テストで差し替える) */
export type CommandSender = { send(command: unknown): Promise<unknown> };

type Options = { region: string; userPoolId: string; client?: CommandSender };

// 例外の種類から、画面に見せる失敗の種類への対応。ここにないものは「利用できない」として扱う
const ERROR_CODES: Record<string, UserAdminErrorCode> = {
  UsernameExistsException: "already-exists",
  AliasExistsException: "already-exists",
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

function toManagedUser(user: UserRecord): ManagedUser | null {
  if (typeof user.Username !== "string") return null;
  const email = user.Attributes?.find((a) => a.Name === "email")?.Value;
  const created = user.UserCreateDate instanceof Date ? user.UserCreateDate : null;
  return {
    username: user.Username,
    email: typeof email === "string" ? email : null,
    status: typeof user.UserStatus === "string" ? user.UserStatus : "UNKNOWN",
    enabled: user.Enabled !== false,
    createdAt: created && !Number.isNaN(created.getTime()) ? created.toISOString() : null,
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

    async inviteUser(email) {
      const output = await call<{ User?: UserRecord }>(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: email,
          UserAttributes: [
            { Name: "email", Value: email },
            // 招待メールが届いたことで、アドレスを確かめたものとする(パスワード再設定のコードを送れるようにする)
            { Name: "email_verified", Value: "true" },
          ],
          DesiredDeliveryMediums: ["EMAIL"],
        }),
      );
      const user = output.User ? toManagedUser(output.User) : null;
      if (!user) throw new UserAdminError("unavailable");
      return user;
    },

    async disableUser(username) {
      await call(new AdminDisableUserCommand({ UserPoolId: userPoolId, Username: username }));
    },

    async promoteUser(username) {
      await call(
        new AdminAddUserToGroupCommand({ UserPoolId: userPoolId, Username: username, GroupName: ADMIN_GROUP }),
      );
    },
  };
}
