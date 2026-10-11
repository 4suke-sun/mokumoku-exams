import { guardDeps } from "@/lib/auth/deps.ts";
import type { HistoryDeps } from "./handlers.ts";
import { getHistoryRepository } from "./repository.ts";

export function historyDeps(): HistoryDeps {
  return { auth: guardDeps(), repository: getHistoryRepository() };
}
