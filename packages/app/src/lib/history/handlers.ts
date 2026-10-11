import { authenticate, type GuardDeps } from "@/lib/auth/guard.ts";
import { guard, json } from "@/lib/auth/handlers.ts";
import { type GradableQuestion, isQuestionCorrect } from "@/lib/quiz.ts";
import type { Result } from "@/lib/storage.ts";
import { examQuestions } from "./questions.ts";
import type { DayTally, HistoryRepository, ReviewChange } from "./repository.ts";
import {
  apiResultSchema,
  BookmarkChangeSchema,
  GoalChangeSchema,
  ListQuerySchema,
  MAX_BODY_BYTES,
  MAX_BOOKMARK_BODY_BYTES,
  MAX_GOAL_BODY_BYTES,
} from "./schema.ts";

/** 採点に使う、問題の正解と採点基準。公開中の資格でなければ null。 */
export type QuestionSource = (examCode: string) => Promise<readonly GradableQuestion[] | null>;

export type HistoryDeps = {
  auth: GuardDeps;
  repository: HistoryRepository;
  now?: () => number;
  /** 既定は data/ の問題データ */
  questions?: QuestionSource;
};

/**
 * エラー応答の形は `{ "error": "<種類>" }` だけ。原因・内部の情報・入力の値は返さない。
 * 種類とステータス: bad-request 400(入力が正しくない)/ unauthorized 401 / forbidden 403(別サイトからの送信)/
 * too-large 413 / bad-request 415(JSON でない形式)/ unavailable 503(保存先の失敗)。
 */
export type HistoryError = "bad-request" | "unauthorized" | "too-large" | "unavailable";

export const fail = (error: HistoryError, status: number, cookies: string[] = []) => json({ error }, status, cookies);

/**
 * ログイン中の利用者を、サーバー側で検証して得る。利用者の識別子(`sub`)は、ここで得たものだけを使う
 * (リクエストの本文・パラメーターからは受け取らない)。
 */
export async function authorize(request: Request, deps: { auth: GuardDeps }) {
  try {
    return await authenticate(request.headers.get("cookie"), deps.auth);
  } catch {
    return null;
  }
}

/** 問い合わせを検査する。同じ名前が 2 回以上あるものは、どちらを使うか曖昧なので断る。 */
function parseQuery(request: Request) {
  const entries = [...new URL(request.url).searchParams.entries()];
  if (new Set(entries.map(([name]) => name)).size !== entries.length) return null;
  const parsed = ListQuerySchema.safeParse(Object.fromEntries(entries));
  return parsed.success ? parsed.data : null;
}

/**
 * 本文を、大きさを確かめてから JSON として読む。大きさは、読み込む前に申告で、読み込んだあとに実際の大きさで確かめる。
 * 断るときは、その応答を返す。
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number,
  setCookies: string[],
): Promise<{ body: unknown } | Response> {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > maxBytes) return fail("too-large", 413, setCookies);
  const text = await request.text().catch(() => "");
  if (new TextEncoder().encode(text).length > maxBytes) return fail("too-large", 413, setCookies);
  try {
    return { body: JSON.parse(text) };
  } catch {
    return fail("bad-request", 400, setCookies);
  }
}

/**
 * 結果を、サーバーの問題データで採点し直して、復習プールの変更にする(端末から送られた正誤は使わない)。
 * 判定は、画面の採点と同じ関数(自由記述は採点基準の判定)。
 * 未回答は不正解として数える。自信なしの印を付けた問題は、正解でも復習に残す(`wrong` に入れる)。
 * いまのデータにない問題は、どちらにも入れない。
 */
export function reviewChangeOf(result: Result, questions: readonly GradableQuestion[]): ReviewChange {
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const change = { wrong: [] as string[], correct: [] as string[], at: result.finishedAt };
  result.questionIds.forEach((id, index) => {
    const question = byId.get(id);
    if (!question) return;
    const correct = isQuestionCorrect(question, result.answers, result.textAnswers);
    const unsure = result.unsure?.[index] === true;
    (correct && !unsure ? change.correct : change.wrong).push(id);
  });
  return change;
}

/** 採点し直した結果の学習量(正答数は、自信なしの印によらず、正誤で数える)。いまのデータにない問題は数えない。 */
export function tallyOf(result: Result, questions: readonly GradableQuestion[]): DayTally {
  const change = reviewChangeOf({ ...result, unsure: undefined }, questions);
  return { answered: change.wrong.length + change.correct.length, correct: change.correct.length };
}

/** 自分の結果を、資格ごとに新しい順で返す。 */
export async function handleListResults(request: Request, deps: HistoryDeps): Promise<Response> {
  const auth = await authorize(request, deps);
  if (!auth) return fail("unauthorized", 401);
  const query = parseQuery(request);
  if (!query) return fail("bad-request", 400, auth.setCookies);
  try {
    const results = await deps.repository.listResults(auth.user.sub, query.examCode);
    return json({ results }, 200, auth.setCookies);
  } catch {
    return fail("unavailable", 503);
  }
}

/**
 * 自分の結果を保存する。同じ資格・同じ完了時刻の結果は上書きなので、繰り返しても重複しない。
 * あわせて、日ごとの学習量(結果が新しいときだけ足す)と、復習プール(送り直しても、同じ変更になる)を更新する。
 * 公開中でない資格の結果は、保存だけする。
 */
export async function handlePostResult(request: Request, deps: HistoryDeps): Promise<Response> {
  const rejected = guard(request);
  if (rejected) return rejected;
  const auth = await authorize(request, deps);
  if (!auth) return fail("unauthorized", 401);

  const read = await readJsonBody(request, MAX_BODY_BYTES, auth.setCookies);
  if (read instanceof Response) return read;
  const parsed = apiResultSchema((deps.now ?? Date.now)()).safeParse(read.body);
  if (!parsed.success) return fail("bad-request", 400, auth.setCookies);
  const result = parsed.data;

  try {
    const questions = await (deps.questions ?? examQuestions)(result.examCode);
    const change = questions ? reviewChangeOf(result, questions) : null;
    await deps.repository.putResult(auth.user.sub, result, questions ? tallyOf(result, questions) : undefined);
    if (change) await deps.repository.updateReview(auth.user.sub, result.examCode, change);
    return json({ status: "saved" }, 200, auth.setCookies);
  } catch {
    return fail("unavailable", 503);
  }
}

/** 資格コードの問い合わせを受ける GET の共通の形。 */
async function listByExam(
  request: Request,
  deps: HistoryDeps,
  load: (sub: string, examCode: string) => Promise<unknown>,
): Promise<Response> {
  const auth = await authorize(request, deps);
  if (!auth) return fail("unauthorized", 401);
  const query = parseQuery(request);
  if (!query) return fail("bad-request", 400, auth.setCookies);
  try {
    return json(await load(auth.user.sub, query.examCode), 200, auth.setCookies);
  } catch {
    return fail("unavailable", 503);
  }
}

/** 自分のブックマークを返す。 */
export function handleListBookmarks(request: Request, deps: HistoryDeps): Promise<Response> {
  return listByExam(request, deps, async (sub, examCode) => ({
    questionIds: await deps.repository.listBookmarks(sub, examCode),
  }));
}

/** 自分の復習プールを返す。 */
export function handleListReview(request: Request, deps: HistoryDeps): Promise<Response> {
  return listByExam(request, deps, async (sub, examCode) => ({
    questionIds: await deps.repository.listReview(sub, examCode),
  }));
}

/** ブックマークを付ける・外す。問題は、公開中の資格の、いまのデータにあるものだけ。 */
export async function handlePutBookmark(request: Request, deps: HistoryDeps): Promise<Response> {
  const rejected = guard(request);
  if (rejected) return rejected;
  const auth = await authorize(request, deps);
  if (!auth) return fail("unauthorized", 401);

  const read = await readJsonBody(request, MAX_BOOKMARK_BODY_BYTES, auth.setCookies);
  if (read instanceof Response) return read;
  const parsed = BookmarkChangeSchema.safeParse(read.body);
  if (!parsed.success) return fail("bad-request", 400, auth.setCookies);
  const change = parsed.data;

  try {
    const questions = await (deps.questions ?? examQuestions)(change.examCode);
    if (!questions?.some((q) => q.questionId === change.questionId)) return fail("bad-request", 400, auth.setCookies);
    await deps.repository.setBookmark(auth.user.sub, change.examCode, change.questionId, change.bookmarked);
    return json({ status: "saved" }, 200, auth.setCookies);
  } catch {
    return fail("unavailable", 503);
  }
}

/** 自分の日ごとの学習量を、日付の順に返す。 */
export function handleListDays(request: Request, deps: HistoryDeps): Promise<Response> {
  return listByExam(request, deps, async (sub, examCode) => ({ days: await deps.repository.listDays(sub, examCode) }));
}

/** 自分の目標日を返す。決めていなければ null。 */
export function handleGetGoal(request: Request, deps: HistoryDeps): Promise<Response> {
  return listByExam(request, deps, async (sub, examCode) => ({ date: await deps.repository.getGoal(sub, examCode) }));
}

/** 目標日を決める・消す。資格は、公開中のものだけ。 */
export async function handlePutGoal(request: Request, deps: HistoryDeps): Promise<Response> {
  const rejected = guard(request);
  if (rejected) return rejected;
  const auth = await authorize(request, deps);
  if (!auth) return fail("unauthorized", 401);

  const read = await readJsonBody(request, MAX_GOAL_BODY_BYTES, auth.setCookies);
  if (read instanceof Response) return read;
  const parsed = GoalChangeSchema.safeParse(read.body);
  if (!parsed.success) return fail("bad-request", 400, auth.setCookies);
  const change = parsed.data;

  try {
    if (!(await (deps.questions ?? examQuestions)(change.examCode))) return fail("bad-request", 400, auth.setCookies);
    await deps.repository.setGoal(auth.user.sub, change.examCode, change.date);
    return json({ status: "saved" }, 200, auth.setCookies);
  } catch {
    return fail("unavailable", 503);
  }
}
