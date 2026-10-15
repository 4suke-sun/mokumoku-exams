import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { EXAM_CODE, QUESTION_ID } from "@mokumoku-exams/data-schema/exam-data/shape";
import { type Prefs, PrefsSchema } from "@/lib/prefs.ts";
import { RECENT_STAT_LIMIT } from "@/lib/question-stats.ts";
import {
  mergeSectionProgress,
  type Result,
  ResultSchema,
  type SectionProgress,
  SectionProgressSchema,
} from "@/lib/storage.ts";
import { isValidDate, jstDate, type StudyDay } from "@/lib/study-days.ts";
import { RESULTS_PAGE_SIZE } from "./limits.ts";
import { MASTER_STREAK } from "./schema.ts";

/** 履歴の保存先。利用者の識別子(`sub`)は、検証済みのものだけを渡す。 */
export interface HistoryRepository {
  /**
   * 結果を保存する(同じ資格・同じ完了時刻は上書きなので、繰り返しても重複しない)。結果は件数の上限なしで、すべて残す。
   * `tally` を渡すと、結果の項目が新しく作られたときだけ、完了時刻の日(日本時間)の学習量に足す(送り直しで二重に数えない)。
   * 結果の項目を新しく作ったら true(上書きなら false)。
   */
  putResult(sub: string, result: Result, tally?: DayTally): Promise<boolean>;
  /**
   * 資格の結果を新しい順に返す。`before`(完了時刻)を渡すと、それより古いものを返す。
   * 1 回に読むのは `limit` 件まで(既定は `RESULTS_PAGE_SIZE`)。続きがあるかもしれないときは、続きを取る位置
   * (読んだ最後の項目の完了時刻)を `next` に返す。壊れた項目を除いても、続きの位置は変わらない。
   * 保存した直後の結果も読めるよう、強い整合性で読む。
   */
  listResults(
    sub: string,
    examCode: string,
    page?: { before?: string; limit?: number },
  ): Promise<{ results: Result[]; next: string | null }>;
  /** 1 回分の結果。なければ null。強い整合性で読む。 */
  getResult(sub: string, examCode: string, finishedAt: string): Promise<Result | null>;
  /**
   * 問題ごとの解答回数と直近の正誤を更新する。同じ完了時刻の正誤は、二重に数えない。
   * 直近の正誤は、完了時刻の順に `RECENT_STAT_LIMIT` 回分を残す。
   */
  updateStats(sub: string, examCode: string, outcomes: readonly QuestionOutcome[], at: string): Promise<void>;
  /** 資格の、問題ごとの解答回数と直近の正誤(古い順)。 */
  listStats(sub: string, examCode: string): Promise<QuestionStat[]>;
  /** ブックマークした問題 ID を、ID の順に返す。 */
  listBookmarks(sub: string, examCode: string): Promise<string[]>;
  /** ブックマークを付ける・外す(同じ操作を繰り返しても、結果は変わらない)。 */
  setBookmark(sub: string, examCode: string, questionId: string, bookmarked: boolean): Promise<void>;
  /** 復習プールの、まだマスターしていない問題 ID を、ID の順に返す。 */
  listReview(sub: string, examCode: string): Promise<string[]>;
  /** すべての資格の復習の項目(マスター済みを含む)。資格と問題 ID の順。 */
  listReviewItems(sub: string): Promise<ReviewItem[]>;
  /**
   * 採点の結果で復習プールを更新する。間違えた問題(自信なしを含む)は、連続正解を 0 にして入れる。
   * プールにある問題に正解すると、連続正解を 1 つ増やし、`MASTER_STREAK` 回続いたらマスターにする。
   */
  updateReview(sub: string, examCode: string, change: ReviewChange): Promise<void>;
  /** 復習から、手で外す(項目を消す)。 */
  removeReview(sub: string, examCode: string, questionId: string): Promise<void>;
  /** 日ごとの学習量を、日付の順に返す。 */
  listDays(sub: string, examCode: string): Promise<StudyDay[]>;
  /** 目標日(`YYYY-MM-DD`)。決めていなければ null。 */
  getGoal(sub: string, examCode: string): Promise<string | null>;
  /** 目標日を決める。null で消す。 */
  setGoal(sub: string, examCode: string, date: string | null): Promise<void>;
  /** セクションで解くモードの進捗。保存していなければ null。 */
  getSections(sub: string, examCode: string): Promise<SectionProgress | null>;
  /**
   * 進捗を取り込み、保存済みの進捗と 1 つにして保存する(セクションごとに正答数の多いほうを残す)。統合した進捗を返す。
   * 2 つの端末が同時に呼ぶと、あとから書いたほうが、先の取り込みを上書きすることがある(次に開いたときの取り込みで戻る)。
   */
  mergeSections(sub: string, examCode: string, incoming: SectionProgress): Promise<SectionProgress>;
  /** 表示の設定(テーマ・画面スタイル・シャッフル)。保存していなければ null。 */
  getPrefs(sub: string): Promise<Prefs | null>;
  /** 表示の設定を保存する(上書き)。 */
  setPrefs(sub: string, prefs: Prefs): Promise<void>;
}

/** 1 回の結果の学習量(解いた問題の数と、そのうちの正解の数)。 */
export type DayTally = { answered: number; correct: number };

/** 復習プールの更新。`at` は、もとにした結果の完了時刻。 */
export type ReviewChange = { wrong: readonly string[]; correct: readonly string[]; at: string };

/** 復習の項目。`streak` は連続正解の数(古い保存で持たないときは 0) */
export type ReviewItem = { examCode: string; questionId: string; streak: number; mastered: boolean };

export { RESULTS_PAGE_SIZE };

/** 1 回の結果での、1 問の正誤 */
export type QuestionOutcome = { questionId: string; correct: boolean };

/** 問題ごとの解答回数と、直近の正誤(古い順。true が正解) */
export type QuestionStat = { questionId: string; count: number; recent: boolean[] };

type RecentEntry = { at: string; correct: boolean };

/** 保存した直近の正誤を読む(壊れた値は除く) */
function recentOf(value: unknown): RecentEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (e): e is RecentEntry =>
      typeof e === "object" && e !== null && typeof e.at === "string" && typeof e.correct === "boolean",
  );
}

/** 直近の正誤に 1 回分を足す(同じ時刻は足さない)。完了時刻の順に並べ、新しい `RECENT_STAT_LIMIT` 回分を残す */
export function addRecent(recent: readonly RecentEntry[], entry: RecentEntry): RecentEntry[] | null {
  if (recent.some((e) => e.at === entry.at)) return null;
  return [...recent, entry].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0)).slice(-RECENT_STAT_LIMIT);
}

/** 復習の項目の、連続正解とマスターを読む(古い保存は、連続正解 0・未マスター) */
function reviewStateOf(item: Record<string, unknown> | undefined): { streak: number; mastered: boolean } {
  const streak = Number.isInteger(item?.streak) && (item?.streak as number) >= 0 ? (item?.streak as number) : 0;
  return { streak, mastered: item?.mastered === true };
}

/** DynamoDB のキー。単一テーブルで、PK=USER#{sub}、SK で種別を分ける。 */
export const userKey = (sub: string) => `USER#${sub}`;
export const resultKeyPrefix = (examCode: string) => `RESULT#${examCode}#`;
export const resultKey = (result: Pick<Result, "examCode" | "finishedAt">) =>
  `${resultKeyPrefix(result.examCode)}${result.finishedAt}`;
export const bookmarkKeyPrefix = (examCode: string) => `BOOKMARK#${examCode}#`;
export const reviewKeyPrefix = (examCode: string) => `REVIEW#${examCode}#`;
export const dayKeyPrefix = (examCode: string) => `DAY#${examCode}#`;
export const goalKey = (examCode: string) => `GOAL#${examCode}`;
/** セクションで解くモードの進捗(資格ごとに 1 件) */
export const sectionsKey = (examCode: string) => `SECTIONS#${examCode}`;
/** 表示の設定(利用者ごとに 1 件) */
export const PREFS_SORT_KEY = "PREFS";
export const statKeyPrefix = (examCode: string) => `STAT#${examCode}#`;
/** すべての資格の復習の項目(資格をまたいで一覧するとき) */
export const REVIEW_PREFIX = "REVIEW#";

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** 保存した日ごとの項目から、学習量を取り出す(壊れた項目は、ないものとして扱う)。 */
function studyDayOf(date: string, answered: unknown, correct: unknown): StudyDay | null {
  if (!isValidDate(date) || !isCount(answered) || !isCount(correct) || correct > answered) return null;
  return { date, answered, correct };
}

/** 保存した項目から、結果の部分だけを取り出して検査する(壊れた項目は null) */
function resultOf(item: Record<string, unknown>): Result | null {
  const parsed = ResultSchema.safeParse({
    examCode: item.examCode,
    questionIds: item.questionIds,
    answers: item.answers,
    textAnswers: item.textAnswers,
    finishedAt: item.finishedAt,
    choiceOrder: item.choiceOrder,
    timesMs: item.timesMs,
    unsure: item.unsure,
    flagged: item.flagged,
  });
  return parsed.success ? parsed.data : null;
}

/** 1 回の更新で、同時に送る書き込みの数(問題が多い結果でも、待ち時間を抑える) */
const WRITE_CONCURRENCY = 10;

async function inChunks<T>(items: readonly T[], run: (item: T) => Promise<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += WRITE_CONCURRENCY) {
    await Promise.all(items.slice(i, i + WRITE_CONCURRENCY).map(run));
  }
}

/** DynamoDB のドキュメントクライアントの、使う操作だけ(テストで差し替える) */
export type DocumentSender = { send(command: unknown): Promise<unknown> };

type QueryOutput = { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };
type PutOutput = { Attributes?: Record<string, unknown> };
type GetOutput = { Item?: Record<string, unknown> };

export function createDynamoRepository(options: { tableName: string; client: DocumentSender }): HistoryRepository {
  const { tableName, client } = options;

  const query = (
    sub: string,
    prefix: string,
    extra: { limit?: number; keysOnly?: boolean; newestFirst?: boolean; startAfter?: string; consistent?: boolean },
  ) =>
    client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": userKey(sub), ":prefix": prefix },
        ...(extra.newestFirst ? { ScanIndexForward: false } : {}),
        ...(extra.limit ? { Limit: extra.limit } : {}),
        ...(extra.keysOnly ? { ProjectionExpression: "SK" } : {}),
        ...(extra.startAfter ? { ExclusiveStartKey: { PK: userKey(sub), SK: extra.startAfter } } : {}),
        ...(extra.consistent ? { ConsistentRead: true } : {}),
      }),
    ) as Promise<QueryOutput>;

  /** 接頭辞の項目を、ページを辿ってすべて読む(1 回の問い合わせは 1MB まで) */
  const queryAll = async (sub: string, prefix: string) => {
    const all: Record<string, unknown>[] = [];
    let startAfter: string | undefined;
    do {
      const { Items = [], LastEvaluatedKey } = await query(sub, prefix, { startAfter });
      all.push(...Items);
      startAfter = LastEvaluatedKey ? String(LastEvaluatedKey.SK) : undefined;
    } while (startAfter);
    return all;
  };
  const get = async (sub: string, sk: string, consistent = false) =>
    (
      (await client.send(
        new GetCommand({
          TableName: tableName,
          Key: { PK: userKey(sub), SK: sk },
          ...(consistent ? { ConsistentRead: true } : {}),
        }),
      )) as GetOutput
    ).Item;

  /** SK の接頭辞のあとに続く問題 ID を取り出す(問題 ID の形のものだけ)。 */
  const questionIdsOf = async (sub: string, prefix: string) => {
    const { Items = [] } = await query(sub, prefix, { keysOnly: true });
    return Items.map((item) => String(item.SK).slice(prefix.length)).filter((id) => QUESTION_ID.test(id));
  };
  const put = (sub: string, sk: string, attributes: Record<string, unknown>) =>
    client.send(new PutCommand({ TableName: tableName, Item: { PK: userKey(sub), SK: sk, ...attributes } }));
  const remove = (sub: string, sk: string) =>
    client.send(new DeleteCommand({ TableName: tableName, Key: { PK: userKey(sub), SK: sk } }));

  return {
    async putResult(sub, result, tally) {
      // 上書きした項目があれば返してもらい、新しく作ったときだけ学習量に足す
      const { Attributes } = (await client.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: userKey(sub), SK: resultKey(result), type: "result", ...result },
          ReturnValues: "ALL_OLD",
        }),
      )) as PutOutput;
      if (!Attributes && tally && tally.answered > 0) {
        const date = jstDate(result.finishedAt);
        // ADD は、項目がなければ 0 から足す(同じ日の保存が重なっても、数え漏れない)
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: userKey(sub), SK: `${dayKeyPrefix(result.examCode)}${date}` },
            UpdateExpression:
              "SET #type = :type, #examCode = :examCode, #date = :date ADD #answered :answered, #correct :correct",
            ExpressionAttributeNames: {
              "#type": "type",
              "#examCode": "examCode",
              "#date": "date",
              "#answered": "answered",
              "#correct": "correct",
            },
            ExpressionAttributeValues: {
              ":type": "day",
              ":examCode": result.examCode,
              ":date": date,
              ":answered": tally.answered,
              ":correct": tally.correct,
            },
          }),
        );
      }
      // 結果は 1 件ずつ別の項目なので、件数の上限なしで残す(古いものを切り詰めない)
      return !Attributes;
    },

    async listResults(sub, examCode, page = {}) {
      // 完了時刻の新しい順。`before` の項目のあとから、`limit` 件まで
      const prefix = resultKeyPrefix(examCode);
      const { Items = [], LastEvaluatedKey } = await query(sub, prefix, {
        limit: page.limit ?? RESULTS_PAGE_SIZE,
        newestFirst: true,
        startAfter: page.before ? `${prefix}${page.before}` : undefined,
        consistent: true,
      });
      // 件数の上限に達すると、続きがなくても `LastEvaluatedKey` が返る(そのときの続きの取得は空になる)
      const lastKey = LastEvaluatedKey ? String(LastEvaluatedKey.SK) : null;
      return {
        results: Items.map(resultOf).filter((r): r is Result => r !== null),
        next: lastKey?.startsWith(prefix) ? lastKey.slice(prefix.length) : null,
      };
    },

    async getResult(sub, examCode, finishedAt) {
      const item = await get(sub, resultKey({ examCode, finishedAt }), true);
      const found = item ? resultOf(item) : null;
      return found && found.examCode === examCode && found.finishedAt === finishedAt ? found : null;
    },

    async updateStats(sub, examCode, outcomes, at) {
      const prefix = statKeyPrefix(examCode);
      await inChunks(outcomes, async ({ questionId, correct }) => {
        const sk = `${prefix}${questionId}`;
        const item = await get(sub, sk);
        const recent = addRecent(recentOf(item?.recent), { at, correct });
        if (!recent) return;
        const count = isCount(item?.count) ? item.count + 1 : 1;
        await put(sub, sk, { type: "stat", examCode, questionId, count, recent });
      });
    },

    async listStats(sub, examCode) {
      const prefix = statKeyPrefix(examCode);
      return (await queryAll(sub, prefix))
        .map((item) => ({
          questionId: String(item.SK).slice(prefix.length),
          count: isCount(item.count) ? item.count : 0,
          recent: recentOf(item.recent).map((e) => e.correct),
        }))
        .filter((stat) => QUESTION_ID.test(stat.questionId));
    },

    listBookmarks: (sub, examCode) => questionIdsOf(sub, bookmarkKeyPrefix(examCode)),

    async setBookmark(sub, examCode, questionId, bookmarked) {
      const sk = `${bookmarkKeyPrefix(examCode)}${questionId}`;
      if (bookmarked) await put(sub, sk, { type: "bookmark", examCode, questionId });
      else await remove(sub, sk);
    },

    async listReview(sub, examCode) {
      const prefix = reviewKeyPrefix(examCode);
      return (await queryAll(sub, prefix))
        .filter((item) => !reviewStateOf(item).mastered)
        .map((item) => String(item.SK).slice(prefix.length))
        .filter((id) => QUESTION_ID.test(id));
    },

    async listReviewItems(sub) {
      return (await queryAll(sub, REVIEW_PREFIX)).flatMap((item): ReviewItem[] => {
        const [examCode = "", questionId = ""] = String(item.SK).slice(REVIEW_PREFIX.length).split("#");
        if (!QUESTION_ID.test(questionId) || !EXAM_CODE.test(examCode)) return [];
        return [{ examCode, questionId, ...reviewStateOf(item) }];
      });
    },

    async updateReview(sub, examCode, change) {
      const prefix = reviewKeyPrefix(examCode);
      await inChunks(change.wrong, (id) =>
        put(sub, `${prefix}${id}`, { type: "review", examCode, questionId: id, wrongAt: change.at, streak: 0 }),
      );
      // プールにある問題だけ、連続正解を増やす(ない問題は何もしない)。マスターしたら、印を付けて残す(数を出すため)
      await inChunks(change.correct, async (id) => {
        const item = await get(sub, `${prefix}${id}`);
        if (!item) return;
        const state = reviewStateOf(item);
        if (state.mastered) return;
        const streak = state.streak + 1;
        await put(sub, `${prefix}${id}`, {
          ...item,
          streak,
          ...(streak >= MASTER_STREAK ? { mastered: true, masteredAt: change.at } : {}),
        });
      });
    },

    async removeReview(sub, examCode, questionId) {
      await remove(sub, `${reviewKeyPrefix(examCode)}${questionId}`);
    },

    async listDays(sub, examCode) {
      const prefix = dayKeyPrefix(examCode);
      // 日付の順(SK の並びが日付の並びと一致する)
      const { Items = [] } = await query(sub, prefix, {});
      return Items.map((item) => studyDayOf(String(item.SK).slice(prefix.length), item.answered, item.correct)).filter(
        (day): day is StudyDay => day !== null,
      );
    },

    async getGoal(sub, examCode) {
      const { Item } = (await client.send(
        new GetCommand({ TableName: tableName, Key: { PK: userKey(sub), SK: goalKey(examCode) } }),
      )) as GetOutput;
      const date = Item?.date;
      return typeof date === "string" && isValidDate(date) ? date : null;
    },

    async setGoal(sub, examCode, date) {
      if (date === null) await remove(sub, goalKey(examCode));
      else await put(sub, goalKey(examCode), { type: "goal", examCode, date });
    },

    async getSections(sub, examCode) {
      const { Item } = (await client.send(
        new GetCommand({ TableName: tableName, Key: { PK: userKey(sub), SK: sectionsKey(examCode) } }),
      )) as GetOutput;
      // 保存した値は外部入力として扱い、形を検査する(壊れた値は、保存していないものとして扱う)
      const parsed = SectionProgressSchema.safeParse({ examCode: Item?.examCode, best: Item?.best, last: Item?.last });
      return parsed.success && parsed.data.examCode === examCode ? parsed.data : null;
    },

    async mergeSections(sub, examCode, incoming) {
      const merged = mergeSectionProgress((await this.getSections(sub, examCode)) ?? { examCode, best: {} }, incoming);
      await put(sub, sectionsKey(examCode), {
        type: "sections",
        examCode,
        best: merged.best,
        ...(merged.last ? { last: merged.last } : {}),
      });
      return merged;
    },

    async getPrefs(sub) {
      const { Item } = (await client.send(
        new GetCommand({ TableName: tableName, Key: { PK: userKey(sub), SK: PREFS_SORT_KEY } }),
      )) as GetOutput;
      // 保存した値は外部入力として扱い、形を検査する(壊れた値は、保存していないものとして扱う)
      const parsed = PrefsSchema.safeParse({
        theme: Item?.theme,
        style: Item?.style,
        shuffleChoices: Item?.shuffleChoices,
      });
      return parsed.success ? parsed.data : null;
    },

    async setPrefs(sub, prefs) {
      await put(sub, PREFS_SORT_KEY, { type: "prefs", ...prefs });
    },
  };
}

/** 手元の開発とテスト用の、メモリ上の保存先。 */
export function createMemoryRepository(): HistoryRepository {
  const store = new Map<string, Map<string, Result>>();
  // 利用者と資格ごとの、問題 ID の集合
  const bookmarks = new Map<string, Set<string>>();
  // 利用者と資格ごとの、問題 ID ごとの復習の状態と、解答回数・直近の正誤
  const review = new Map<string, Map<string, { streak: number; mastered: boolean }>>();
  const stats = new Map<string, Map<string, { count: number; recent: RecentEntry[] }>>();
  // 利用者と資格ごとの、日付ごとの学習量と、目標日
  const days = new Map<string, Map<string, StudyDay>>();
  const goals = new Map<string, string>();
  const sections = new Map<string, SectionProgress>();
  // 利用者ごとの、表示の設定
  const prefs = new Map<string, Prefs>();
  const scope = (sub: string, examCode: string) => `${userKey(sub)}|${examCode}`;
  const setOf = (sets: Map<string, Set<string>>, sub: string, examCode: string) => {
    const key = scope(sub, examCode);
    const found = sets.get(key) ?? new Set<string>();
    sets.set(key, found);
    return found;
  };
  const mapOf = <T>(maps: Map<string, Map<string, T>>, sub: string, examCode: string) => {
    const key = scope(sub, examCode);
    const found = maps.get(key) ?? new Map<string, T>();
    maps.set(key, found);
    return found;
  };
  const sorted = (sub: string, examCode: string) =>
    [...(store.get(userKey(sub))?.values() ?? [])]
      .filter((r) => r.examCode === examCode)
      .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0));
  return {
    async putResult(sub, result, tally) {
      const own = store.get(userKey(sub)) ?? new Map<string, Result>();
      const created = !own.has(resultKey(result));
      own.set(resultKey(result), result);
      if (created && tally && tally.answered > 0) {
        const date = jstDate(result.finishedAt);
        const perDay = days.get(scope(sub, result.examCode)) ?? new Map<string, StudyDay>();
        const before = perDay.get(date) ?? { date, answered: 0, correct: 0 };
        perDay.set(date, {
          date,
          answered: before.answered + tally.answered,
          correct: before.correct + tally.correct,
        });
        days.set(scope(sub, result.examCode), perDay);
      }
      store.set(userKey(sub), own);
      return created;
    },
    async listResults(sub, examCode, page = {}) {
      const { before } = page;
      const limit = page.limit ?? RESULTS_PAGE_SIZE;
      const rest = sorted(sub, examCode).filter((r) => before === undefined || r.finishedAt < before);
      const results = rest.slice(0, limit);
      // DynamoDB と同じく、上限に達したら、続きがなくても続きの位置を返す
      return { results, next: rest.length >= limit ? (results.at(-1)?.finishedAt ?? null) : null };
    },
    async getResult(sub, examCode, finishedAt) {
      return store.get(userKey(sub))?.get(resultKey({ examCode, finishedAt })) ?? null;
    },
    async updateStats(sub, examCode, outcomes, at) {
      const own = mapOf(stats, sub, examCode);
      for (const { questionId, correct } of outcomes) {
        const before = own.get(questionId) ?? { count: 0, recent: [] };
        const recent = addRecent(before.recent, { at, correct });
        if (recent) own.set(questionId, { count: before.count + 1, recent });
      }
    },
    async listStats(sub, examCode) {
      return [...mapOf(stats, sub, examCode).entries()]
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([questionId, stat]) => ({ questionId, count: stat.count, recent: stat.recent.map((e) => e.correct) }));
    },
    async listBookmarks(sub, examCode) {
      return [...setOf(bookmarks, sub, examCode)].sort();
    },
    async setBookmark(sub, examCode, questionId, bookmarked) {
      const own = setOf(bookmarks, sub, examCode);
      if (bookmarked) own.add(questionId);
      else own.delete(questionId);
    },
    async listReview(sub, examCode) {
      return [...mapOf(review, sub, examCode).entries()]
        .filter(([, state]) => !state.mastered)
        .map(([id]) => id)
        .sort();
    },
    async listReviewItems(sub) {
      const prefix = `${userKey(sub)}|`;
      return [...review.entries()]
        .filter(([key]) => key.startsWith(prefix))
        .flatMap(([key, own]) =>
          [...own.entries()].map(([questionId, state]) => ({
            examCode: key.slice(prefix.length),
            questionId,
            ...state,
          })),
        )
        .sort((a, b) => `${a.examCode}#${a.questionId}`.localeCompare(`${b.examCode}#${b.questionId}`));
    },
    async updateReview(sub, examCode, change) {
      const own = mapOf(review, sub, examCode);
      for (const id of change.wrong) own.set(id, { streak: 0, mastered: false });
      for (const id of change.correct) {
        const state = own.get(id);
        if (!state || state.mastered) continue;
        const streak = state.streak + 1;
        own.set(id, { streak, mastered: streak >= MASTER_STREAK });
      }
    },
    async removeReview(sub, examCode, questionId) {
      mapOf(review, sub, examCode).delete(questionId);
    },
    async listDays(sub, examCode) {
      return [...(days.get(scope(sub, examCode))?.values() ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
    },
    async getGoal(sub, examCode) {
      return goals.get(scope(sub, examCode)) ?? null;
    },
    async getSections(sub, examCode) {
      return sections.get(scope(sub, examCode)) ?? null;
    },
    async mergeSections(sub, examCode, incoming) {
      const merged = mergeSectionProgress(sections.get(scope(sub, examCode)) ?? { examCode, best: {} }, incoming);
      sections.set(scope(sub, examCode), merged);
      return merged;
    },
    async getPrefs(sub) {
      return prefs.get(sub) ?? null;
    },
    async setPrefs(sub, value) {
      prefs.set(sub, { ...value });
    },
    async setGoal(sub, examCode, date) {
      if (date === null) goals.delete(scope(sub, examCode));
      else goals.set(scope(sub, examCode), date);
    },
  };
}

const shared = globalThis as typeof globalThis & { __mokumokuFakeHistory?: HistoryRepository };
let dynamo: { key: string; repository: HistoryRepository } | undefined;

/**
 * 履歴の保存先を選ぶ。本番は DynamoDB。手元の開発だけ、`AUTH_FAKE=1` でメモリ上の代替に切り替えられる
 * (本番の設定では、この指定があっても使わない)。
 */
export function getHistoryRepository(env: NodeJS.ProcessEnv = process.env): HistoryRepository {
  if (env.NODE_ENV !== "production" && env.AUTH_FAKE === "1") {
    shared.__mokumokuFakeHistory ??= createMemoryRepository();
    return shared.__mokumokuFakeHistory;
  }
  const { HISTORY_TABLE_NAME: tableName, AWS_REGION: region } = env;
  if (!tableName || !region) throw new Error("履歴の設定(HISTORY_TABLE_NAME / AWS_REGION)がありません。");
  const key = `${region}/${tableName}`;
  if (dynamo?.key !== key) {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }), {
      marshallOptions: { removeUndefinedValues: true },
    });
    dynamo = { key, repository: createDynamoRepository({ tableName, client }) };
  }
  return dynamo.repository;
}
