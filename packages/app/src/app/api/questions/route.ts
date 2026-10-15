import { questionsDeps } from "@/lib/questions/deps.ts";
import { handleGetQuestions } from "@/lib/questions/handlers.ts";

// 読み出しだが、問題 ID の一覧を本文で受けるので POST にする(問い合わせの文字列の長さに収まらないため)
export const POST = (request: Request) => handleGetQuestions(request, questionsDeps());
