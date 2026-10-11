import { historyDeps } from "@/lib/history/deps.ts";
import { handleGetGoal, handlePutGoal } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleGetGoal(request, historyDeps());
export const PUT = (request: Request) => handlePutGoal(request, historyDeps());
