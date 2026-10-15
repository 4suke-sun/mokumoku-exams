import { acceptBody, acceptQuery, fail, unavailable } from "@/lib/api/endpoint.ts";
import type { GuardDeps } from "@/lib/auth/guard.ts";
import { json } from "@/lib/auth/handlers.ts";
import { MAX_PREFS_BODY_BYTES, PrefsSchema } from "@/lib/prefs.ts";
import { prefsSetCookie } from "@/lib/prefs-cookie.ts";
import { type GradableQuestion, isQuestionCorrect } from "@/lib/quiz.ts";
import type { Result } from "@/lib/storage.ts";
import { examQuestions } from "./questions.ts";
import {
  type DayTally,
  type HistoryRepository,
  type QuestionOutcome,
  RESULTS_PAGE_SIZE,
  type ReviewChange,
} from "./repository.ts";
import {
  apiResultSchema,
  BookmarkChangeSchema,
  EmptyQuerySchema,
  GoalChangeSchema,
  ListQuerySchema,
  MAX_BODY_BYTES,
  MAX_BOOKMARK_BODY_BYTES,
  MAX_GOAL_BODY_BYTES,
  MAX_REVIEW_BODY_BYTES,
  MAX_SECTIONS_BODY_BYTES,
  ResultQuerySchema,
  ResultsQuerySchema,
  ReviewRemovalSchema,
  SectionsChangeSchema,
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

/** 採点し直した、問題ごとの正誤(自信なしの印によらない)。いまのデータにない問題は含めない。同じ問題は 1 回だけ */
export function outcomesOf(result: Result, questions: readonly GradableQuestion[]): QuestionOutcome[] {
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  return [...new Set(result.questionIds)].flatMap((id) => {
    const question = byId.get(id);
    return question
      ? [{ questionId: id, correct: isQuestionCorrect(question, result.answers, result.textAnswers) }]
      : [];
  });
}

/** 採点し直した結果の学習量(正答数は、自信なしの印によらず、正誤で数える)。いまのデータにない問題は数えない。 */
export function tallyOf(result: Result, questions: readonly GradableQuestion[]): DayTally {
  const change = reviewChangeOf({ ...result, unsure: undefined }, questions);
  return { answered: change.wrong.length + change.correct.length, correct: change.correct.length };
}

/**
 * 自分の結果を、資格ごとに新しい順で返す。1 回に `RESULTS_PAGE_SIZE` 件まで。続きがあるかもしれないときは、
 * `next` に、次の問い合わせの `before` に渡す完了時刻を返す(なければ null)。
 */
export async function handleListResults(request: Request, deps: HistoryDeps): Promise<Response> {
  const accepted = await acceptQuery(request, deps, { access: "user", query: ResultsQuerySchema });
  if (accepted instanceof Response) return accepted;
  const { auth, query } = accepted;
  try {
    const { results, next } = await deps.repository.listResults(auth.user.sub, query.examCode, {
      before: query.before,
      limit: RESULTS_PAGE_SIZE,
    });
    return json({ results, next }, 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
  }
}

/** 自分の 1 回分の結果を返す。なければ 404。 */
export async function handleGetResult(request: Request, deps: HistoryDeps): Promise<Response> {
  const accepted = await acceptQuery(request, deps, { access: "user", query: ResultQuerySchema });
  if (accepted instanceof Response) return accepted;
  const { auth, query } = accepted;
  try {
    const result = await deps.repository.getResult(auth.user.sub, query.examCode, query.finishedAt);
    return result ? json({ result }, 200, auth.setCookies) : fail("not-found", 404, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
  }
}

/**
 * 自分の結果を保存する。同じ資格・同じ完了時刻の結果は上書きなので、繰り返しても重複しない。
 * あわせて、日ごとの学習量(結果が新しいときだけ足す)と、復習プール(送り直しても、同じ変更になる)を更新する。
 * 公開中でない資格の結果は、保存だけする。
 */
export async function handlePostResult(request: Request, deps: HistoryDeps): Promise<Response> {
  const accepted = await acceptBody(request, deps, {
    access: "user",
    maxBytes: MAX_BODY_BYTES,
    body: apiResultSchema((deps.now ?? Date.now)()),
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body: result } = accepted;

  try {
    const questions = await (deps.questions ?? examQuestions)(result.examCode);
    const change = questions ? reviewChangeOf(result, questions) : null;
    const created = await deps.repository.putResult(
      auth.user.sub,
      result,
      questions ? tallyOf(result, questions) : undefined,
    );
    // 問題ごとの解答回数と直近の正誤は、結果を新しく保存したときだけ数える(送り直しで二重に数えない)
    if (questions && created) {
      await deps.repository.updateStats(
        auth.user.sub,
        result.examCode,
        outcomesOf(result, questions),
        result.finishedAt,
      );
    }
    if (change) await deps.repository.updateReview(auth.user.sub, result.examCode, change);
    return json({ status: "saved" }, 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
  }
}

/** 資格コードの問い合わせを受ける GET の共通の形。 */
async function listByExam(
  request: Request,
  deps: HistoryDeps,
  load: (sub: string, examCode: string) => Promise<unknown>,
): Promise<Response> {
  const accepted = await acceptQuery(request, deps, { access: "user", query: ListQuerySchema });
  if (accepted instanceof Response) return accepted;
  const { auth, query } = accepted;
  try {
    return json(await load(auth.user.sub, query.examCode), 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
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
  const accepted = await acceptBody(request, deps, {
    access: "user",
    maxBytes: MAX_BOOKMARK_BODY_BYTES,
    body: BookmarkChangeSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body: change } = accepted;

  try {
    const questions = await (deps.questions ?? examQuestions)(change.examCode);
    if (!questions?.some((q) => q.questionId === change.questionId)) return fail("bad-request", 400, auth.setCookies);
    await deps.repository.setBookmark(auth.user.sub, change.examCode, change.questionId, change.bookmarked);
    return json({ status: "saved" }, 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
  }
}

/** 自分の、問題ごとの解答回数と直近の正誤を返す。 */
export function handleListStats(request: Request, deps: HistoryDeps): Promise<Response> {
  return listByExam(request, deps, async (sub, examCode) => ({
    stats: await deps.repository.listStats(sub, examCode),
  }));
}

/** 自分の、すべての資格の復習の項目(連続正解とマスター)を返す。問い合わせは受け付けない。 */
export async function handleListReviewItems(request: Request, deps: HistoryDeps): Promise<Response> {
  const accepted = await acceptQuery(request, deps, { access: "user", query: EmptyQuerySchema });
  if (accepted instanceof Response) return accepted;
  const { auth } = accepted;
  try {
    return json({ items: await deps.repository.listReviewItems(auth.user.sub) }, 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
  }
}

/** 自分の復習から、手で外す。外すのは、サーバー側で検証した利用者の区画の項目だけ。 */
export async function handleDeleteReview(request: Request, deps: HistoryDeps): Promise<Response> {
  const accepted = await acceptBody(request, deps, {
    access: "user",
    maxBytes: MAX_REVIEW_BODY_BYTES,
    body: ReviewRemovalSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body } = accepted;

  try {
    await deps.repository.removeReview(auth.user.sub, body.examCode, body.questionId);
    return json({ status: "removed" }, 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
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
  const accepted = await acceptBody(request, deps, {
    access: "user",
    maxBytes: MAX_GOAL_BODY_BYTES,
    body: GoalChangeSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body: change } = accepted;

  try {
    if (!(await (deps.questions ?? examQuestions)(change.examCode))) return fail("bad-request", 400, auth.setCookies);
    await deps.repository.setGoal(auth.user.sub, change.examCode, change.date);
    return json({ status: "saved" }, 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
  }
}

/** 自分のセクションの進捗を返す。保存していなければ、記録のない進捗。 */
export function handleGetSections(request: Request, deps: HistoryDeps): Promise<Response> {
  return listByExam(request, deps, async (sub, examCode) => ({
    progress: (await deps.repository.getSections(sub, examCode)) ?? { examCode, best: {} },
  }));
}

/** セクションの進捗を取り込む(保存済みの進捗と 1 つにする)。資格は、公開中のものだけ。統合した進捗を返す。 */
export async function handlePutSections(request: Request, deps: HistoryDeps): Promise<Response> {
  const accepted = await acceptBody(request, deps, {
    access: "user",
    maxBytes: MAX_SECTIONS_BODY_BYTES,
    body: SectionsChangeSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body: incoming } = accepted;

  try {
    if (!(await (deps.questions ?? examQuestions)(incoming.examCode))) return fail("bad-request", 400, auth.setCookies);
    const progress = await deps.repository.mergeSections(auth.user.sub, incoming.examCode, incoming);
    return json({ status: "saved", progress }, 200, auth.setCookies);
  } catch (error) {
    return unavailable(request, error);
  }
}

/**
 * 自分の表示の設定を返す。保存していなければ null。保存済みなら、設定の Cookie も付ける
 * (別の端末でログインしたとき、次の描画から、サーバーが設定を反映できる)。
 */
export async function handleGetPrefs(request: Request, deps: HistoryDeps): Promise<Response> {
  const accepted = await acceptQuery(request, deps, { access: "user", query: EmptyQuerySchema });
  if (accepted instanceof Response) return accepted;
  const { auth } = accepted;
  try {
    const prefs = await deps.repository.getPrefs(auth.user.sub);
    const cookies = prefs
      ? [...auth.setCookies, prefsSetCookie(auth.user.sub, prefs, deps.auth.secure)]
      : auth.setCookies;
    return json({ prefs }, 200, cookies);
  } catch (error) {
    return unavailable(request, error);
  }
}

/**
 * 表示の設定を保存する(上書き)。保存するのは、検証した ID トークンの利用者の分だけ。利用者の識別子は、本文から受け取らない
 * (本文に足すと、未知の項目として断る)。設定の Cookie も付ける。
 */
export async function handlePutPrefs(request: Request, deps: HistoryDeps): Promise<Response> {
  const accepted = await acceptBody(request, deps, {
    access: "user",
    maxBytes: MAX_PREFS_BODY_BYTES,
    body: PrefsSchema,
  });
  if (accepted instanceof Response) return accepted;
  const { auth, body } = accepted;

  try {
    await deps.repository.setPrefs(auth.user.sub, body);
    return json({ status: "saved" }, 200, [...auth.setCookies, prefsSetCookie(auth.user.sub, body, deps.auth.secure)]);
  } catch (error) {
    return unavailable(request, error);
  }
}
