import { historyDeps } from "@/lib/history/deps.ts";
import { handleListDays } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleListDays(request, historyDeps());
