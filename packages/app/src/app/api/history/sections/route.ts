import { historyDeps } from "@/lib/history/deps.ts";
import { handleGetSections, handlePutSections } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleGetSections(request, historyDeps());
export const PUT = (request: Request) => handlePutSections(request, historyDeps());
