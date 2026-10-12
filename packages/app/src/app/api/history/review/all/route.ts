import { historyDeps } from "@/lib/history/deps.ts";
import { handleListReviewItems } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleListReviewItems(request, historyDeps());
