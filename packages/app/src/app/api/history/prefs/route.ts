import { historyDeps } from "@/lib/history/deps.ts";
import { handleGetPrefs, handlePutPrefs } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleGetPrefs(request, historyDeps());
export const PUT = (request: Request) => handlePutPrefs(request, historyDeps());
