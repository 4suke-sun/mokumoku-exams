import type { GuardDeps } from "./guard.ts";
import type { Deps } from "./handlers.ts";
import { getAuthProvider, getTokenVerifier } from "./index.ts";

export function authDeps(): Deps {
  return { provider: getAuthProvider(), secure: process.env.NODE_ENV === "production", now: Date.now };
}

/** ID トークンの検証で使う依存(proxy と履歴 API が共通で使う) */
export function guardDeps(): GuardDeps {
  return { verifier: getTokenVerifier(), provider: getAuthProvider(), secure: process.env.NODE_ENV === "production" };
}
