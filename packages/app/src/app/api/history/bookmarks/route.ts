import { historyDeps } from "@/lib/history/deps.ts";
import { handleListBookmarks, handlePutBookmark } from "@/lib/history/handlers.ts";

export const GET = (request: Request) => handleListBookmarks(request, historyDeps());
export const PUT = (request: Request) => handlePutBookmark(request, historyDeps());
