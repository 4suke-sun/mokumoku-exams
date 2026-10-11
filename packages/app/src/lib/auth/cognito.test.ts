import { describe, expect, it } from "vitest";
import { createCognitoProvider } from "./cognito.ts";
import { AuthError } from "./types.ts";

type Call = { url: string; headers: Record<string, string>; body: Record<string, unknown> };

function provider(respond: (call: Call) => { ok: boolean; body: unknown } | Error) {
  const calls: Call[] = [];
  const cognito = createCognitoProvider({
    region: "us-east-1",
    clientId: "client-example",
    fetch: async (url, init) => {
      const call = { url, headers: init.headers, body: JSON.parse(init.body) };
      calls.push(call);
      const result = respond(call);
      if (result instanceof Error) throw result;
      return { ok: result.ok, json: async () => result.body };
    },
  });
  return { cognito, calls };
}

const authResult = {
  AuthenticationResult: { IdToken: "id", AccessToken: "access", RefreshToken: "refresh", ExpiresIn: 3600 },
};

async function codeOf(promise: Promise<unknown>): Promise<string | undefined> {
  try {
    await promise;
  } catch (error) {
    return error instanceof AuthError ? error.code : "other";
  }
  return undefined;
}

describe("createCognitoProvider", () => {
  it("パスワードでログインすると_トークンが返り_宛先とクライアント ID が正しい", async () => {
    const { cognito, calls } = provider(() => ({ ok: true, body: authResult }));
    const result = await cognito.signIn("user@example.com", "pw");
    expect(result).toEqual({
      kind: "signed-in",
      tokens: { idToken: "id", accessToken: "access", refreshToken: "refresh", expiresIn: 3600 },
    });
    expect(calls[0]?.url).toBe("https://cognito-idp.us-east-1.amazonaws.com/");
    expect(calls[0]?.headers["x-amz-target"]).toBe("AWSCognitoIdentityProviderService.InitiateAuth");
    expect(calls[0]?.body).toMatchObject({ ClientId: "client-example", AuthFlow: "USER_PASSWORD_AUTH" });
  });

  it("招待直後のログインでは_新しいパスワードの要求が返る", async () => {
    const { cognito } = provider(() => ({
      ok: true,
      body: { ChallengeName: "NEW_PASSWORD_REQUIRED", Session: "s", ChallengeParameters: { USER_ID_FOR_SRP: "u" } },
    }));
    expect(await cognito.signIn("user@example.com", "temp")).toEqual({
      kind: "new-password-required",
      session: "s",
      username: "u",
    });
  });

  it("新しいパスワードを決めると_チャレンジに応答してトークンが返る", async () => {
    const { cognito, calls } = provider(() => ({ ok: true, body: authResult }));
    const tokens = await cognito.completeNewPassword({ username: "u", session: "s", newPassword: "np" });
    expect(tokens.idToken).toBe("id");
    expect(calls[0]?.body).toMatchObject({
      ChallengeName: "NEW_PASSWORD_REQUIRED",
      Session: "s",
      ChallengeResponses: { USERNAME: "u", NEW_PASSWORD: "np" },
    });
  });

  it.each([
    ["NotAuthorizedException", "invalid-credentials"],
    ["UserNotFoundException", "invalid-credentials"],
    ["InvalidPasswordException", "password-policy"],
    ["CodeMismatchException", "code-invalid"],
    ["ExpiredCodeException", "code-expired"],
    ["LimitExceededException", "limit-exceeded"],
    ["SomethingNewException", "unavailable"],
  ])("失敗の種類が%sのとき_%sとして扱う", async (type, expected) => {
    const { cognito } = provider(() => ({ ok: false, body: { __type: type } }));
    expect(await codeOf(cognito.signIn("a@example.com", "pw"))).toBe(expected);
  });

  it("失敗の応答のメッセージは_エラーに含めない", async () => {
    const marker = "MARKER-should-not-leak";
    const { cognito } = provider(() => ({ ok: false, body: { __type: "NotAuthorizedException", message: marker } }));
    const error = await cognito.signIn("a@example.com", "pw").catch((e: Error) => e);
    expect(String(error)).not.toContain(marker);
    expect((error as Error).message).not.toContain(marker);
  });

  it("通信が失敗したとき_利用できないとして扱う", async () => {
    const { cognito } = provider(() => new Error("network MARKER"));
    expect(await codeOf(cognito.signIn("a@example.com", "pw"))).toBe("unavailable");
  });

  it("再設定の依頼で利用者がいなくても_成功として扱うが_回数の制限は伝える", async () => {
    const missing = provider(() => ({ ok: false, body: { __type: "UserNotFoundException" } }));
    await expect(missing.cognito.requestPasswordReset("a@example.com")).resolves.toBeUndefined();
    const limited = provider(() => ({ ok: false, body: { __type: "LimitExceededException" } }));
    expect(await codeOf(limited.cognito.requestPasswordReset("a@example.com"))).toBe("limit-exceeded");
  });

  it("トークンの更新で_リフレッシュトークンが返らなくてもよい", async () => {
    const { cognito, calls } = provider(() => ({
      ok: true,
      body: { AuthenticationResult: { IdToken: "i", AccessToken: "a", ExpiresIn: 60 } },
    }));
    const tokens = await cognito.refresh("r");
    expect(tokens.refreshToken).toBeUndefined();
    expect(calls[0]?.body).toMatchObject({ AuthFlow: "REFRESH_TOKEN_AUTH", AuthParameters: { REFRESH_TOKEN: "r" } });
  });

  it("応答の形が想定と違うとき_利用できないとして扱う", async () => {
    const { cognito } = provider(() => ({ ok: true, body: { AuthenticationResult: { IdToken: 1 } } }));
    expect(await codeOf(cognito.signIn("a@example.com", "pw"))).toBe("unavailable");
  });

  it("ログアウトで_リフレッシュトークンの無効化を呼ぶ", async () => {
    const { cognito, calls } = provider(() => ({ ok: true, body: {} }));
    await cognito.signOut("r");
    expect(calls[0]?.headers["x-amz-target"]).toBe("AWSCognitoIdentityProviderService.RevokeToken");
    expect(calls[0]?.body).toMatchObject({ Token: "r" });
  });
});
