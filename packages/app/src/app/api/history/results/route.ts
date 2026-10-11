import { historyDeps } from "@/lib/history/deps.ts";
import { handleListResults, handlePostResult } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleListResults(request, historyDeps());
export const POST = (request: Request) => handlePostResult(request, historyDeps());
