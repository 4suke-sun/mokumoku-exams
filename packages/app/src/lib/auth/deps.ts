import type { Deps } from "./handlers.ts";
import { getAuthProvider } from "./index.ts";

export function authDeps(): Deps {
  return { provider: getAuthProvider(), secure: process.env.NODE_ENV === "production", now: Date.now };
}
