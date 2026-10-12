import { z } from "zod";
import { type Result, ResultSchema } from "@/lib/storage.ts";
import { DATE_PATTERN, type StudyDay } from "@/lib/study-days.ts";

const ListSchema = z.object({ results: z.array(ResultSchema).max(50) });
const OneSchema = z.object({ result: ResultSchema });

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

/**
 * サーバーに保存した自分の 1 回分の結果。ないときは "not-found"、取得できないとき(ログイン切れ・通信の失敗など)は null。
 */
export async function fetchServerResult(examCode: string, finishedAt: string): Promise<Result | "not-found" | null> {
  try {
    const query = `examCode=${encodeURIComponent(examCode)}&finishedAt=${encodeURIComponent(finishedAt)}`;
    const response = await fetch(`/api/history/result?${query}`, { cache: "no-store" });
    if (response.status === 404 || response.status === 400) return "not-found";
    if (!response.ok) return null;
    const parsed = OneSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.result : null;
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

const count = z.number().int().min(0);
const DaysSchema = z.object({
  days: z.array(z.object({ date: z.string().regex(DATE_PATTERN), answered: count, correct: count })).max(100_000),
});

/** 日ごとの学習量(日付の順)。取得できなければ null。 */
export async function fetchDays(examCode: string): Promise<StudyDay[] | null> {
  try {
    const response = await fetch(`/api/history/days?examCode=${encodeURIComponent(examCode)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = DaysSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.days : null;
  } catch {
    return null;
  }
}

const GoalSchema = z.object({ date: z.string().regex(DATE_PATTERN).nullable() });

/** 目標日。決めていなければ `{ date: null }`、取得できなければ null。 */
export async function fetchGoal(examCode: string): Promise<{ date: string | null } | null> {
  try {
    const response = await fetch(`/api/history/goal?examCode=${encodeURIComponent(examCode)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = GoalSchema.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** 目標日を決める(null で消す)。保存できたら true。 */
export async function putGoal(examCode: string, date: string | null): Promise<boolean> {
  try {
    const response = await fetch("/api/history/goal", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examCode, date }),
    });
    return response.ok;
  } catch {
    return false;
  }
}

const StatsSchema = z.object({
  stats: z
    .array(
      z.object({
        questionId: z.string().max(64),
        count: z.number().int().min(0),
        recent: z.array(z.boolean()).max(5),
      }),
    )
    .max(100_000),
});

/** 問題ごとの解答回数と直近の正誤(古い順)。取得できなければ null。 */
export async function fetchStats(examCode: string): Promise<Map<string, { count: number; recent: boolean[] }> | null> {
  try {
    const response = await fetch(`/api/history/stats?examCode=${encodeURIComponent(examCode)}`, { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = StatsSchema.safeParse(await response.json());
    return parsed.success
      ? new Map(parsed.data.stats.map((s) => [s.questionId, { count: s.count, recent: s.recent }]))
      : null;
  } catch {
    return null;
  }
}

const ReviewItemsSchema = z.object({
  items: z
    .array(
      z.object({
        examCode: z.string().max(16),
        questionId: z.string().max(64),
        streak: z.number().int().min(0),
        mastered: z.boolean(),
      }),
    )
    .max(100_000),
});

export type ReviewItemView = z.infer<typeof ReviewItemsSchema>["items"][number];

/** すべての資格の復習の項目。取得できなければ null。 */
export async function fetchReviewItems(): Promise<ReviewItemView[] | null> {
  try {
    const response = await fetch("/api/history/review/all", { cache: "no-store" });
    if (!response.ok) return null;
    const parsed = ReviewItemsSchema.safeParse(await response.json());
    return parsed.success ? parsed.data.items : null;
  } catch {
    return null;
  }
}

/** 復習から、手で外す。外せたら true。 */
export async function removeReview(examCode: string, questionId: string): Promise<boolean> {
  try {
    const response = await fetch("/api/history/review", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ examCode, questionId }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
