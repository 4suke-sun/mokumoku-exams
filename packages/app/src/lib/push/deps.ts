import { guardDeps } from "@/lib/auth/deps.ts";
import type { PushDeps } from "./handlers.ts";
import { getPushRepository } from "./repository.ts";
import { TEST_TTL_SECONDS, webPushSender } from "./send.ts";
import { readVapid } from "./vapid.ts";

export function pushDeps(): PushDeps {
  const vapid = readVapid(process.env);
  return {
    auth: guardDeps(),
    repository: getPushRepository(),
    sender: vapid ? webPushSender(vapid, TEST_TTL_SECONDS) : null,
  };
}
