import { historyDeps } from "@/lib/history/deps.ts";
import { handleListReview } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleListReview(request, historyDeps());
