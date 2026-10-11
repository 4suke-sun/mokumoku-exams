import { pushDeps } from "@/lib/push/deps.ts";
import { handleSubscribe, handleUnsubscribe } from "@/lib/push/handlers.ts";

export const PUT = (request: Request) => handleSubscribe(request, pushDeps());
export const DELETE = (request: Request) => handleUnsubscribe(request, pushDeps());
