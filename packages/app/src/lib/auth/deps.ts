import type { GuardDeps } from "./guard.ts";
import type { Deps, SignUpDeps } from "./handlers.ts";
import { getAuthProvider, getTokenVerifier, getUserAdmin } from "./index.ts";

export function authDeps(): Deps {
  return { provider: getAuthProvider(), secure: process.env.NODE_ENV === "production", now: Date.now };
}

/** ID トークンの検証で使う依存(proxy と履歴 API が共通で使う) */
export function guardDeps(): GuardDeps {
  return { verifier: getTokenVerifier(), provider: getAuthProvider(), secure: process.env.NODE_ENV === "production" };
}

/** 登録の API の依存(登録済みのメールアドレスの状態を、Cognito の管理 API で読む) */
export function signUpDeps(): SignUpDeps {
  return { ...authDeps(), users: getUserAdmin() };
}
