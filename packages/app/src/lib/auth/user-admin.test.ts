import {
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminGetUserCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { describe, expect, it } from "vitest";
import {
  createFakeDirectory,
  createFakeProvider,
  createFakeUserAdmin,
  FAKE_SIGNUP_CODE,
  FAKE_USER_EMAIL,
  FAKE_USER_PHRASE,
  fakeSub,
} from "./fake.ts";
import {
  type CommandSender,
  createCognitoUserAdmin,
  isStaleUnconfirmed,
  UNCONFIRMED_REPLACE_AFTER_MS,
  UserAdminError,
} from "./user-admin.ts";

const POOL = "us-east-1_Example";
// 規則に合うテスト用の値。実行時に組み立てる
const FRESH = ["Example", "Fresh", "Phrase-9"].join("-");
const CREATED = new Date("2026-01-02T03:04:05.000Z");

/** 送られた命令を記録し、決めた応答(または例外)を返す */
function sender(reply: (command: unknown) => unknown) {
  const sent: unknown[] = [];
  const client: CommandSender = {
    async send(command) {
      sent.push(command);
      const result = reply(command);
      if (result instanceof Error) throw result;
      return result;
    },
  };
  return { sent, client };
}

const awsError = (name: string) => Object.assign(new Error("detail that must not leak"), { name });

describe("createCognitoUserAdmin", () => {
  it("一覧_UserPool を指定して取り_メールアドレス・状態・作成日にする_ページをたどる", async () => {
    const { sent, client } = sender((command) => {
      const input = (command as ListUsersCommand).input;
      if (!input.PaginationToken)
        return {
          Users: [
            {
              Username: "user-1",
              Attributes: [{ Name: "email", Value: "one@example.com" }],
              UserCreateDate: CREATED,
              Enabled: true,
              UserStatus: "CONFIRMED",
            },
          ],
          PaginationToken: "next",
        };
      return { Users: [{ Username: "user-2", Enabled: false, UserStatus: "FORCE_CHANGE_PASSWORD" }, {}] };
    });
    const users = await createCognitoUserAdmin({ region: "us-east-1", userPoolId: POOL, client }).listUsers();
    expect(users).toEqual([
      {
        username: "user-1",
        email: "one@example.com",
        status: "CONFIRMED",
        enabled: true,
        createdAt: CREATED.toISOString(),
      },
      { username: "user-2", email: null, status: "FORCE_CHANGE_PASSWORD", enabled: false, createdAt: null },
    ]);
    expect(sent).toHaveLength(2);
    for (const command of sent) {
      expect(command).toBeInstanceOf(ListUsersCommand);
      expect((command as ListUsersCommand).input).toMatchObject({ UserPoolId: POOL, AttributesToGet: ["email"] });
    }
    expect((sent[1] as ListUsersCommand).input.PaginationToken).toBe("next");
  });

  it("無効化_UserPool とユーザー名を指定する", async () => {
    const { sent, client } = sender(() => ({}));
    await createCognitoUserAdmin({ region: "us-east-1", userPoolId: POOL, client }).disableUser("user-1");
    expect(sent[0]).toBeInstanceOf(AdminDisableUserCommand);
    expect((sent[0] as AdminDisableUserCommand).input).toEqual({ UserPoolId: POOL, Username: "user-1" });
  });

  it("状態の読み取り_メールアドレスで AdminGetUser を呼び_状態と作成日時を返す_いなければ null", async () => {
    const { sent, client } = sender(() => ({ Username: "user-4", UserStatus: "UNCONFIRMED", UserCreateDate: CREATED }));
    const admin = createCognitoUserAdmin({ region: "us-east-1", userPoolId: POOL, client });
    expect(await admin.getSignUpState("new@example.com")).toEqual({
      status: "UNCONFIRMED",
      createdAt: CREATED.toISOString(),
    });
    expect(sent[0]).toBeInstanceOf(AdminGetUserCommand);
    expect((sent[0] as AdminGetUserCommand).input).toEqual({ UserPoolId: POOL, Username: "new@example.com" });
    const missing = sender(() => awsError("UserNotFoundException"));
    const none = createCognitoUserAdmin({ region: "us-east-1", userPoolId: POOL, client: missing.client });
    expect(await none.getSignUpState("new@example.com")).toBeNull();
  });

  const DAY_AFTER = CREATED.getTime() + UNCONFIRMED_REPLACE_AFTER_MS;

  it("未確認で作成から 24 時間たったアカウント_状態を読み直してから AdminDeleteUser で消す", async () => {
    const { sent, client } = sender((command) =>
      command instanceof AdminGetUserCommand ? { UserStatus: "UNCONFIRMED", UserCreateDate: CREATED } : {},
    );
    const admin = createCognitoUserAdmin({ region: "us-east-1", userPoolId: POOL, client });
    expect(await admin.deleteStaleUnconfirmed("new@example.com", DAY_AFTER)).toBe(true);
    expect(sent.map((c) => c?.constructor)).toEqual([AdminGetUserCommand, AdminDeleteUserCommand]);
    expect((sent[1] as AdminDeleteUserCommand).input).toEqual({ UserPoolId: POOL, Username: "new@example.com" });
  });

  it.each([
    ["CONFIRMED", DAY_AFTER + UNCONFIRMED_REPLACE_AFTER_MS],
    ["FORCE_CHANGE_PASSWORD", DAY_AFTER],
    ["RESET_REQUIRED", DAY_AFTER],
    ["UNCONFIRMED", DAY_AFTER - 1],
  ])("状態が%sで時刻が%sのアカウント_削除を呼ばない(確認済みは決して消さない)", async (status, now) => {
    const { sent, client } = sender(() => ({ UserStatus: status, UserCreateDate: CREATED }));
    const admin = createCognitoUserAdmin({ region: "us-east-1", userPoolId: POOL, client });
    expect(await admin.deleteStaleUnconfirmed("new@example.com", now)).toBe(false);
    expect(sent.some((c) => c instanceof AdminDeleteUserCommand)).toBe(false);
  });

  it("作成日時が取れない未確認のアカウント_削除を呼ばない", async () => {
    const { sent, client } = sender(() => ({ UserStatus: "UNCONFIRMED" }));
    const admin = createCognitoUserAdmin({ region: "us-east-1", userPoolId: POOL, client });
    expect(await admin.deleteStaleUnconfirmed("new@example.com", DAY_AFTER)).toBe(false);
    expect(sent.some((c) => c instanceof AdminDeleteUserCommand)).toBe(false);
  });

  it("24 時間の境目_ちょうど 24 時間で置き換えられ_作成日時が読めなければ置き換えない", () => {
    const createdAt = CREATED.toISOString();
    expect(isStaleUnconfirmed({ status: "UNCONFIRMED", createdAt }, DAY_AFTER)).toBe(true);
    expect(isStaleUnconfirmed({ status: "UNCONFIRMED", createdAt }, DAY_AFTER - 1)).toBe(false);
    expect(isStaleUnconfirmed({ status: "UNCONFIRMED", createdAt: "broken" }, DAY_AFTER)).toBe(false);
    expect(isStaleUnconfirmed({ status: "CONFIRMED", createdAt }, DAY_AFTER)).toBe(false);
  });

  it.each([
    ["UserNotFoundException", "not-found"],
    ["InvalidParameterException", "bad-request"],
    ["TooManyRequestsException", "limit-exceeded"],
    ["AccessDeniedException", "unavailable"],
    ["Error", "unavailable"],
  ])("失敗_%s は種類 %s にし_原因の文言を持ち出さない", async (name, code) => {
    const { client } = sender(() => awsError(name));
    const admin = createCognitoUserAdmin({ region: "us-east-1", userPoolId: POOL, client });
    const error = await admin.disableUser("user-1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserAdminError);
    expect(error).toMatchObject({ code, message: code });
  });
});

describe("createFakeUserAdmin", () => {
  it("登録して確認がまだの利用者_一覧に確認待ちで出て_確認すると確認済みになる", async () => {
    const directory = createFakeDirectory();
    const users = createFakeUserAdmin(directory);
    const provider = createFakeProvider(Date.now, directory);
    await provider.signUp("fresh@example.com", FRESH);
    expect((await users.listUsers()).find((u) => u.email === "fresh@example.com")?.status).toBe("UNCONFIRMED");
    expect(await users.getSignUpState("fresh@example.com")).toMatchObject({ status: "UNCONFIRMED" });
    await provider.confirmSignUp({ email: "fresh@example.com", code: FAKE_SIGNUP_CODE });
    expect(await users.getSignUpState("fresh@example.com")).toMatchObject({ status: "CONFIRMED" });
    expect(await users.getSignUpState("nobody@example.com")).toBeNull();
  });

  it("確認待ちの利用者の削除_24 時間たったものだけを消し_確認済みは消さない", async () => {
    let now = Date.parse("2026-01-01T00:00:00.000Z");
    const directory = createFakeDirectory(() => now);
    const users = createFakeUserAdmin(directory);
    const provider = createFakeProvider(() => now, directory);
    await provider.signUp("fresh@example.com", FRESH);
    now += UNCONFIRMED_REPLACE_AFTER_MS - 1;
    expect(await users.deleteStaleUnconfirmed("fresh@example.com", now)).toBe(false);
    now += 1;
    expect(await users.deleteStaleUnconfirmed(FAKE_USER_EMAIL, now)).toBe(false);
    expect(await users.deleteStaleUnconfirmed("fresh@example.com", now)).toBe(true);
    expect(await users.getSignUpState("fresh@example.com")).toBeNull();
    expect(await users.getSignUpState(FAKE_USER_EMAIL)).toMatchObject({ status: "CONFIRMED" });
  });

  it("無効にした利用者_ログインもトークンの更新もできない_いない利用者は断る", async () => {
    const directory = createFakeDirectory();
    const users = createFakeUserAdmin(directory);
    const provider = createFakeProvider(Date.now, directory);
    const before = await provider.signIn(FAKE_USER_EMAIL, FAKE_USER_PHRASE);
    if (before.kind !== "signed-in" || !before.tokens.refreshToken) throw new Error("unexpected");
    await users.disableUser(fakeSub(FAKE_USER_EMAIL));
    expect((await users.listUsers()).find((u) => u.email === FAKE_USER_EMAIL)?.enabled).toBe(false);
    await expect(provider.signIn(FAKE_USER_EMAIL, FAKE_USER_PHRASE)).rejects.toMatchObject({
      code: "invalid-credentials",
    });
    await expect(provider.refresh(before.tokens.refreshToken)).rejects.toMatchObject({ code: "invalid-credentials" });
    await expect(users.disableUser("fake-nobody")).rejects.toMatchObject({ code: "not-found" });
  });
});
