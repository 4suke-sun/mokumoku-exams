import { pushDeps } from "@/lib/push/deps.ts";
import { handleTestNotification } from "@/lib/push/handlers.ts";

export const POST = (request: Request) => handleTestNotification(request, pushDeps());
