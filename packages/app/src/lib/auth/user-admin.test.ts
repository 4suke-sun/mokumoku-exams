import {
  AdminCreateUserCommand,
  AdminDisableUserCommand,
  ListUsersCommand,
} from "@aws-sdk/client-cognito-identity-provider";
import { describe, expect, it } from "vitest";
import {
  createFakeDirectory,
  createFakeProvider,
  createFakeUserAdmin,
  FAKE_INVITED_PHRASE,
  FAKE_USER_EMAIL,
  FAKE_USER_PHRASE,
  fakeSub,
} from "./fake.ts";
import { type CommandSender, createCognitoUserAdmin, UserAdminError } from "./user-admin.ts";

const POOL = "us-east-1_Example";
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

  it("招待_メールアドレスをユーザー名にして作り_招待メールを送る", async () => {
    const { sent, client } = sender(() => ({
      User: {
        Username: "user-3",
        Attributes: [{ Name: "email", Value: "new@example.com" }],
        UserCreateDate: CREATED,
        Enabled: true,
        UserStatus: "FORCE_CHANGE_PASSWORD",
      },
    }));
    const user = await createCognitoUserAdmin({ region: "us-east-1", userPoolId: POOL, client }).inviteUser(
      "new@example.com",
    );
    expect(user).toMatchObject({ username: "user-3", email: "new@example.com", status: "FORCE_CHANGE_PASSWORD" });
    expect(sent[0]).toBeInstanceOf(AdminCreateUserCommand);
    expect((sent[0] as AdminCreateUserCommand).input).toEqual({
      UserPoolId: POOL,
      Username: "new@example.com",
      UserAttributes: [
        { Name: "email", Value: "new@example.com" },
        { Name: "email_verified", Value: "true" },
      ],
      DesiredDeliveryMediums: ["EMAIL"],
    });
  });

  it("無効化_UserPool とユーザー名を指定する", async () => {
    const { sent, client } = sender(() => ({}));
    await createCognitoUserAdmin({ region: "us-east-1", userPoolId: POOL, client }).disableUser("user-1");
    expect(sent[0]).toBeInstanceOf(AdminDisableUserCommand);
    expect((sent[0] as AdminDisableUserCommand).input).toEqual({ UserPoolId: POOL, Username: "user-1" });
  });

  it.each([
    ["UsernameExistsException", "already-exists"],
    ["UserNotFoundException", "not-found"],
    ["InvalidParameterException", "bad-request"],
    ["TooManyRequestsException", "limit-exceeded"],
    ["AccessDeniedException", "unavailable"],
    ["Error", "unavailable"],
  ])("失敗_%s は種類 %s にし_原因の文言を持ち出さない", async (name, code) => {
    const { client } = sender(() => awsError(name));
    const admin = createCognitoUserAdmin({ region: "us-east-1", userPoolId: POOL, client });
    const error = await admin.inviteUser("new@example.com").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UserAdminError);
    expect(error).toMatchObject({ code, message: code });
  });
});

describe("createFakeUserAdmin", () => {
  it("招待した利用者_一覧に出て_仮パスワードで初回の設定へ進める_同じアドレスは断る", async () => {
    const directory = createFakeDirectory();
    const users = createFakeUserAdmin(directory);
    const provider = createFakeProvider(Date.now, directory);
    const invited = await users.inviteUser("fresh@example.com");
    expect(invited).toMatchObject({ email: "fresh@example.com", status: "FORCE_CHANGE_PASSWORD", enabled: true });
    expect((await users.listUsers()).map((u) => u.email)).toContain("fresh@example.com");
    expect(await provider.signIn("fresh@example.com", FAKE_INVITED_PHRASE)).toMatchObject({
      kind: "new-password-required",
    });
    await expect(users.inviteUser("fresh@example.com")).rejects.toMatchObject({ code: "already-exists" });
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
