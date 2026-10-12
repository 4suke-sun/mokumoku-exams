import { historyDeps } from "@/lib/history/deps.ts";
import { handleDeleteReview, handleListReview } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleListReview(request, historyDeps());
export const DELETE = (request: Request) => handleDeleteReview(request, historyDeps());
