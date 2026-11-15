import { feedbackDeps } from "@/lib/feedback/deps.ts";
import { handleFeedback } from "@/lib/feedback/handlers.ts";

// ログインした利用者だけが送れる(入口の proxy と、ハンドラーの両方で確かめる)
export const POST = (request: Request) => handleFeedback(request, feedbackDeps());
