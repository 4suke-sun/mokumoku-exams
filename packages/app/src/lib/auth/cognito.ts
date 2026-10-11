import { AuthError, type AuthErrorCode, type AuthProvider, type SignInResult, type Tokens } from "./types.ts";

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{
  ok: boolean;
  json(): Promise<unknown>;
}>;

type Options = { region: string; clientId: string; fetch?: FetchLike };

// 例外の種類から、画面に見せる失敗の種類への対応。ここにないものは「利用できない」として扱う
const ERROR_CODES: Record<string, AuthErrorCode> = {
  NotAuthorizedException: "invalid-credentials",
  UserNotFoundException: "invalid-credentials",
  UserNotConfirmedException: "invalid-credentials",
  PasswordResetRequiredException: "invalid-credentials",
  InvalidPasswordException: "password-policy",
  CodeMismatchException: "code-invalid",
  ExpiredCodeException: "code-expired",
  LimitExceededException: "limit-exceeded",
  TooManyRequestsException: "limit-exceeded",
  TooManyFailedAttemptsException: "limit-exceeded",
};

/**
 * Cognito の認証 API(認証情報のいらない操作)を、fetch で直接呼ぶ。
 * クライアントはシークレットを持たず、これらの操作は IAM の署名が要らないため、SDK を入れずに済む。
 */
export function createCognitoProvider(options: Options): AuthProvider {
  const endpoint = `https://cognito-idp.${options.region}.amazonaws.com/`;
  const doFetch: FetchLike = options.fetch ?? ((url, init) => fetch(url, init));

  async function call(target: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await doFetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/x-amz-json-1.1",
          "x-amz-target": `AWSCognitoIdentityProviderService.${target}`,
        },
        body: JSON.stringify({ ClientId: options.clientId, ...body }),
      });
    } catch {
      throw new AuthError("unavailable");
    }
    // 応答の本文(メッセージ)は使わない。種類だけを見る
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      const type = typeof payload.__type === "string" ? (payload.__type.split("#").pop() ?? "") : "";
      throw new AuthError(ERROR_CODES[type] ?? "unavailable");
    }
    return payload;
  }

  function tokensFrom(payload: Record<string, unknown>): Tokens {
    const result = payload.AuthenticationResult as Record<string, unknown> | undefined;
    const { IdToken, AccessToken, RefreshToken, ExpiresIn } = result ?? {};
    if (typeof IdToken !== "string" || typeof AccessToken !== "string" || typeof ExpiresIn !== "number") {
      throw new AuthError("unavailable");
    }
    return {
      idToken: IdToken,
      accessToken: AccessToken,
      refreshToken: typeof RefreshToken === "string" ? RefreshToken : undefined,
      expiresIn: ExpiresIn,
    };
  }

  return {
    async signIn(email, password): Promise<SignInResult> {
      const payload = await call("InitiateAuth", {
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: { USERNAME: email, PASSWORD: password },
      });
      if (payload.ChallengeName === "NEW_PASSWORD_REQUIRED") {
        const params = (payload.ChallengeParameters ?? {}) as Record<string, unknown>;
        const username = params.USER_ID_FOR_SRP;
        if (typeof payload.Session !== "string" || typeof username !== "string") throw new AuthError("unavailable");
        return { kind: "new-password-required", session: payload.Session, username };
      }
      return { kind: "signed-in", tokens: tokensFrom(payload) };
    },

    async completeNewPassword({ username, session, newPassword }) {
      const payload = await call("RespondToAuthChallenge", {
        ChallengeName: "NEW_PASSWORD_REQUIRED",
        Session: session,
        ChallengeResponses: { USERNAME: username, NEW_PASSWORD: newPassword },
      });
      return tokensFrom(payload);
    },

    async requestPasswordReset(email) {
      try {
        await call("ForgotPassword", { Username: email });
      } catch (error) {
        // 登録の有無を知らせないため、利用者がいない場合の失敗は成功と同じに扱う。回数の制限などは伝える
        if (error instanceof AuthError && error.code === "limit-exceeded") throw error;
      }
    },

    async confirmPasswordReset({ email, code, newPassword }) {
      await call("ConfirmForgotPassword", { Username: email, ConfirmationCode: code, Password: newPassword });
    },

    async refresh(refreshToken) {
      const payload = await call("InitiateAuth", {
        AuthFlow: "REFRESH_TOKEN_AUTH",
        AuthParameters: { REFRESH_TOKEN: refreshToken },
      });
      return tokensFrom(payload);
    },

    async changePassword({ accessToken, previousPassword, proposedPassword }) {
      await call("ChangePassword", {
        AccessToken: accessToken,
        PreviousPassword: previousPassword,
        ProposedPassword: proposedPassword,
      });
    },

    async signOut(refreshToken) {
      await call("RevokeToken", { Token: refreshToken });
    },
  };
}
