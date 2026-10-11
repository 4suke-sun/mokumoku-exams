import { guardDeps } from "@/lib/auth/deps.ts";
import { getUserAdmin } from "@/lib/auth/index.ts";
import { getAuditLog } from "./audit.ts";
import type { AdminDeps } from "./handlers.ts";

export function adminDeps(): AdminDeps {
  return { auth: guardDeps(), users: getUserAdmin(), audit: getAuditLog() };
}
