import { z } from "zod";
import { type Result, ResultSchema } from "@/lib/storage.ts";

const ListSchema = z.object({ results: z.array(ResultSchema).max(50) });

/**
 * サーバーに保存した自分の結果を取得する。ログインが切れた・通信できない・サーバーが失敗したときは null
 * (呼び出し側が、この端末の記録に切り替える)。
 */
export async function fetchServerResults(examCode: string): Promise<Result[] | null> {
  try {
    const response = await fetch(`/api/history/results?examCode=${encodeURIComponent(examCode)}`, {
      cache: "no-store",
    });
    if (!response.ok) return null;
    const parsed = ListSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.results : null;
  } catch {
    return null;
  }
}

/** 結果をサーバーに保存する。保存できたら true。 */
export async function postServerResult(result: Result): Promise<boolean> {
  try {
    const response = await fetch("/api/history/results", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(result),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const QuestionIdsSchema = z.object({ questionIds: z.array(z.string().max(64)).max(1000) });

async function fetchQuestionIds(path: string, examCode: string): Promise<string[] | null> {
  try {
    const response = await fetch(`${path}?examCode=${encodeURIComponent(examCode)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = QuestionIdsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.questionIds : null;
  } catch {
    return null;
  }
}

/** ブックマークした問題 ID。取得できなければ null。 */
export function fetchBookmarks(examCode: string): Promise<string[] | null> {
  return fetchQuestionIds("/api/history/bookmarks", examCode);
}

/** 復習プールの問題 ID。取得できなければ null。 */
export function fetchReview(examCode: string): Promise<string[] | null> {
  return fetchQuestionIds("/api/history/review", examCode);
}

/** ブックマークを付ける・外す。保存できたら true。 */
export async function putBookmark(examCode: string, questionId: string, bookmarked: boolean): Promise<boolean> {
  try {
    const response = await fetch("/api/history/bookmarks", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examCode, questionId, bookmarked }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
