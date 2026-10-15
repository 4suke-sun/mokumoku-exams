import { EXAM_CODE } from "@mokumoku-exams/data-schema/exam-data/shape";
import { z } from "zod";
import { requestJson } from "@/lib/api/client.ts";
import {
  type KeyValueStore,
  loadSectionProgress,
  mergeSectionProgress,
  type Result,
  ResultSchema,
  type SectionProgress,
  SectionProgressSchema,
  saveSectionProgress,
} from "@/lib/storage.ts";
import { DATE_PATTERN, type StudyDay } from "@/lib/study-days.ts";
import { RESULTS_PAGE_SIZE } from "./limits.ts";

const ListSchema = z.object({
  results: z.array(ResultSchema).max(RESULTS_PAGE_SIZE),
  next: z.string().nullable().optional(),
});
const OneSchema = z.object({ result: ResultSchema });

/** 結果の一覧の 1 ページ。`next` は、続きを取るときに渡す位置(続きがなければ null) */
export type ResultsPage = { results: Result[]; next: string | null };

/**
 * サーバーに保存した自分の結果を、新しい順に 1 ページ取得する。`before` を渡すと、その続きを取る。
 * ログインが切れた・通信できない・サーバーが失敗したときは null(呼び出し側が、この端末の記録に切り替える)。
 */
export async function fetchServerResultsPage(examCode: string, before?: string): Promise<ResultsPage | null> {
  const query = `examCode=${encodeURIComponent(examCode)}${before ? `&before=${encodeURIComponent(before)}` : ""}`;
  const result = await requestJson(`/api/history/results?${query}`, { schema: ListSchema });
  return result.ok ? { results: result.data.results, next: result.data.next ?? null } : null;
}

/** サーバーに保存した自分の結果の、最初のページ。取得できなければ null。 */
export async function fetchServerResults(examCode: string): Promise<Result[] | null> {
  return (await fetchServerResultsPage(examCode))?.results ?? null;
}

/**
 * サーバーに保存した自分の 1 回分の結果。ないときは "not-found"、取得できないとき(ログイン切れ・通信の失敗など)は null。
 */
export async function fetchServerResult(examCode: string, finishedAt: string): Promise<Result | "not-found" | null> {
  const query = `examCode=${encodeURIComponent(examCode)}&finishedAt=${encodeURIComponent(finishedAt)}`;
  const result = await requestJson(`/api/history/result?${query}`, { schema: OneSchema });
  if (result.ok) return result.data.result;
  return result.status === 404 || result.status === 400 ? "not-found" : null;
}

/** 結果をサーバーに保存する。保存できたら true。 */
export async function postServerResult(result: Result): Promise<boolean> {
  return (await requestJson("/api/history/results", { method: "POST", body: result })).ok;
}

const QuestionIdsSchema = z.object({ questionIds: z.array(z.string().max(64)).max(1000) });

async function fetchQuestionIds(path: string, examCode: string): Promise<string[] | null> {
  const result = await requestJson(`${path}?examCode=${encodeURIComponent(examCode)}`, { schema: QuestionIdsSchema });
  return result.ok ? result.data.questionIds : null;
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
  return (await requestJson("/api/history/bookmarks", { method: "PUT", body: { examCode, questionId, bookmarked } }))
    .ok;
}

const count = z.number().int().min(0);
const DaysSchema = z.object({
  days: z.array(z.object({ date: z.string().regex(DATE_PATTERN), answered: count, correct: count })).max(100_000),
});

/** 日ごとの学習量(日付の順)。取得できなければ null。 */
export async function fetchDays(examCode: string): Promise<StudyDay[] | null> {
  const result = await requestJson(`/api/history/days?examCode=${encodeURIComponent(examCode)}`, {
    schema: DaysSchema,
  });
  return result.ok ? result.data.days : null;
}

const GoalSchema = z.object({ date: z.string().regex(DATE_PATTERN).nullable() });

/** 目標日。決めていなければ `{ date: null }`、取得できなければ null。 */
export async function fetchGoal(examCode: string): Promise<{ date: string | null } | null> {
  const result = await requestJson(`/api/history/goal?examCode=${encodeURIComponent(examCode)}`, {
    schema: GoalSchema,
  });
  return result.ok ? result.data : null;
}

/** 目標日を決める(null で消す)。保存できたら true。 */
export async function putGoal(examCode: string, date: string | null): Promise<boolean> {
  return (await requestJson("/api/history/goal", { method: "PUT", body: { examCode, date } })).ok;
}

const SectionsSchema = z.object({ progress: SectionProgressSchema });

/** サーバーに保存したセクションの進捗。取得できなければ null(ログイン切れ・通信の失敗など)。 */
export async function fetchSectionProgress(examCode: string): Promise<SectionProgress | null> {
  const result = await requestJson(`/api/history/sections?examCode=${encodeURIComponent(examCode)}`, {
    schema: SectionsSchema,
  });
  return result.ok && result.data.progress.examCode === examCode ? result.data.progress : null;
}

/** セクションの進捗を、サーバーの進捗と 1 つにして保存する。統合した進捗を返す。保存できなければ null。 */
export async function putSectionProgress(progress: SectionProgress): Promise<SectionProgress | null> {
  const result = await requestJson("/api/history/sections", { method: "PUT", body: progress, schema: SectionsSchema });
  return result.ok && result.data.progress.examCode === progress.examCode ? result.data.progress : null;
}

/**
 * 端末のセクションの進捗と、サーバーの進捗を 1 つにして、画面に出す進捗を返す。
 * - サーバーを読めないとき(未ログイン・通信の失敗)は、端末の進捗をそのまま返す。
 * - 端末に、サーバーにない記録(別の端末で解く前の記録や、保存に失敗した記録)があれば、サーバーに取り込む。
 * - 統合した進捗は、端末にも保存する。
 * 端末の記録は、`browserStore()` の持ち主の照合を通したものだけを扱う。ほかのアカウントの記録はキーが違うので読まず、取り込まない。
 * 持ち主の印が取れないときは、端末の記録を読まないので、サーバーの進捗だけになる。
 */
export async function syncSectionProgress(store: KeyValueStore, examCode: string): Promise<SectionProgress> {
  const local = loadSectionProgress(store, examCode);
  const server = await fetchSectionProgress(examCode);
  if (!server) return local;
  const merged = mergeSectionProgress(server, local);
  const result =
    JSON.stringify(merged) === JSON.stringify(server) ? server : ((await putSectionProgress(local)) ?? merged);
  saveSectionProgress(store, result);
  return result;
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
  const result = await requestJson(`/api/history/stats?examCode=${encodeURIComponent(examCode)}`, {
    schema: StatsSchema,
  });
  return result.ok ? new Map(result.data.stats.map((s) => [s.questionId, { count: s.count, recent: s.recent }])) : null;
}

const ReviewItemsSchema = z.object({
  items: z
    .array(
      z.object({
        examCode: z.string().regex(EXAM_CODE),
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
  const result = await requestJson("/api/history/review/all", { schema: ReviewItemsSchema });
  return result.ok ? result.data.items : null;
}

/** 復習から、手で外す。外せたら true。 */
export async function removeReview(examCode: string, questionId: string): Promise<boolean> {
  return (await requestJson("/api/history/review", { method: "DELETE", body: { examCode, questionId } })).ok;
}
