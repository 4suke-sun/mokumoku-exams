import { historyDeps } from "@/lib/history/deps.ts";
import { handleGetNotebook, handlePutNotebook } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleGetNotebook(request, historyDeps());
export const PUT = (request: Request) => handlePutNotebook(request, historyDeps());
