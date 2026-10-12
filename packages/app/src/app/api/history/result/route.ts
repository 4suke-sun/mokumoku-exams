import { historyDeps } from "@/lib/history/deps.ts";
import { handleGetResult } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleGetResult(request, historyDeps());
