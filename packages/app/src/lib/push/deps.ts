import { guardDeps } from "@/lib/auth/deps.ts";
import type { PushDeps } from "./handlers.ts";
import { getPushRepository } from "./repository.ts";
import { readVapid, TEST_TTL_SECONDS, webPushSender } from "./send.ts";

export function pushDeps(): PushDeps {
  const vapid = readVapid(process.env);
  return {
    auth: guardDeps(),
    repository: getPushRepository(),
    sender: vapid ? webPushSender(vapid, TEST_TTL_SECONDS) : null,
  };
}
