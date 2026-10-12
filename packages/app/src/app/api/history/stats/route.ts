import { historyDeps } from "@/lib/history/deps.ts";
import { handleListStats } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleListStats(request, historyDeps());
