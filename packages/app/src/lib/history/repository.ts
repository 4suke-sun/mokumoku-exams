import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import {
  DeleteCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
} from "@aws-sdk/lib-dynamodb";
import { MAX_RESULTS, type Result, ResultSchema } from "@/lib/storage.ts";
import { isValidDate, jstDate, type StudyDay } from "@/lib/study-days.ts";
import { QUESTION_ID_PATTERN } from "./schema.ts";

/** 履歴の保存先。利用者の識別子(`sub`)は、検証済みのものだけを渡す。 */
export interface HistoryRepository {
  /**
   * 結果を保存する(同じ資格・同じ完了時刻は上書きなので、繰り返しても重複しない)。古いものは `MAX_RESULTS` 件までに切り詰める。
   * `tally` を渡すと、結果の項目が新しく作られたときだけ、完了時刻の日(日本時間)の学習量に足す(送り直しで二重に数えない)。
   */
  putResult(sub: string, result: Result, tally?: DayTally): Promise<void>;
  /** 資格の結果を新しい順に返す。 */
  listResults(sub: string, examCode: string): Promise<Result[]>;
  /** ブックマークした問題 ID を、ID の順に返す。 */
  listBookmarks(sub: string, examCode: string): Promise<string[]>;
  /** ブックマークを付ける・外す(同じ操作を繰り返しても、結果は変わらない)。 */
  setBookmark(sub: string, examCode: string, questionId: string, bookmarked: boolean): Promise<void>;
  /** 復習プールの問題 ID を、ID の順に返す。 */
  listReview(sub: string, examCode: string): Promise<string[]>;
  /** 採点の結果で復習プールを更新する。間違えた問題を入れ、正解した問題を外す。 */
  updateReview(sub: string, examCode: string, change: ReviewChange): Promise<void>;
  /** 日ごとの学習量を、日付の順に返す。 */
  listDays(sub: string, examCode: string): Promise<StudyDay[]>;
  /** 目標日(`YYYY-MM-DD`)。決めていなければ null。 */
  getGoal(sub: string, examCode: string): Promise<string | null>;
  /** 目標日を決める。null で消す。 */
  setGoal(sub: string, examCode: string, date: string | null): Promise<void>;
}

/** 1 回の結果の学習量(解いた問題の数と、そのうちの正解の数)。 */
export type DayTally = { answered: number; correct: number };

/** 復習プールの更新。`at` は、もとにした結果の完了時刻。 */
export type ReviewChange = { wrong: readonly string[]; correct: readonly string[]; at: string };

/** DynamoDB のキー。単一テーブルで、PK=USER#{sub}、SK で種別を分ける。 */
export const userKey = (sub: string) => `USER#${sub}`;
export const resultKeyPrefix = (examCode: string) => `RESULT#${examCode}#`;
export const resultKey = (result: Pick<Result, "examCode" | "finishedAt">) =>
  `${resultKeyPrefix(result.examCode)}${result.finishedAt}`;
export const bookmarkKeyPrefix = (examCode: string) => `BOOKMARK#${examCode}#`;
export const reviewKeyPrefix = (examCode: string) => `REVIEW#${examCode}#`;
export const dayKeyPrefix = (examCode: string) => `DAY#${examCode}#`;
export const goalKey = (examCode: string) => `GOAL#${examCode}`;

const isCount = (value: unknown): value is number => Number.isInteger(value) && (value as number) >= 0;

/** 保存した日ごとの項目から、学習量を取り出す(壊れた項目は、ないものとして扱う)。 */
function studyDayOf(date: string, answered: unknown, correct: unknown): StudyDay | null {
  if (!isValidDate(date) || !isCount(answered) || !isCount(correct) || correct > answered) return null;
  return { date, answered, correct };
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

type QueryOutput = { Items?: Record<string, unknown>[] };
type PutOutput = { Attributes?: Record<string, unknown> };
type GetOutput = { Item?: Record<string, unknown> };

export function createDynamoRepository(options: { tableName: string; client: DocumentSender }): HistoryRepository {
  const { tableName, client } = options;

  const query = (sub: string, prefix: string, extra: { limit?: number; keysOnly?: boolean; newestFirst?: boolean }) =>
    client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": userKey(sub), ":prefix": prefix },
        ...(extra.newestFirst ? { ScanIndexForward: false } : {}),
        ...(extra.limit ? { Limit: extra.limit } : {}),
        ...(extra.keysOnly ? { ProjectionExpression: "SK" } : {}),
      }),
    ) as Promise<QueryOutput>;

  /** SK の接頭辞のあとに続く問題 ID を取り出す(問題 ID の形のものだけ)。 */
  const questionIdsOf = async (sub: string, prefix: string) => {
    const { Items = [] } = await query(sub, prefix, { keysOnly: true });
    return Items.map((item) => String(item.SK).slice(prefix.length)).filter((id) => QUESTION_ID_PATTERN.test(id));
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
      // 古いものを切り詰める(1 資格あたり高々 MAX_RESULTS + 数件なので、1 回の問い合わせで足りる)
      const { Items = [] } = await query(sub, resultKeyPrefix(result.examCode), { keysOnly: true, newestFirst: true });
      for (const item of Items.slice(MAX_RESULTS)) await remove(sub, String(item.SK));
    },

    async listResults(sub, examCode) {
      // 完了時刻の新しい順
      const { Items = [] } = await query(sub, resultKeyPrefix(examCode), { limit: MAX_RESULTS, newestFirst: true });
      const results: Result[] = [];
      for (const item of Items) {
        // 保存した項目から、結果の部分だけを取り出して検査する(壊れた項目は、ないものとして扱う)
        const parsed = ResultSchema.safeParse({
          examCode: item.examCode,
          questionIds: item.questionIds,
          answers: item.answers,
          textAnswers: item.textAnswers,
          finishedAt: item.finishedAt,
          choiceOrder: item.choiceOrder,
        });
        if (parsed.success) results.push(parsed.data);
      }
      return results;
    },

    listBookmarks: (sub, examCode) => questionIdsOf(sub, bookmarkKeyPrefix(examCode)),

    async setBookmark(sub, examCode, questionId, bookmarked) {
      const sk = `${bookmarkKeyPrefix(examCode)}${questionId}`;
      if (bookmarked) await put(sub, sk, { type: "bookmark", examCode, questionId });
      else await remove(sub, sk);
    },

    listReview: (sub, examCode) => questionIdsOf(sub, reviewKeyPrefix(examCode)),

    async updateReview(sub, examCode, change) {
      const prefix = reviewKeyPrefix(examCode);
      await inChunks(change.wrong, (id) =>
        put(sub, `${prefix}${id}`, { type: "review", examCode, questionId: id, wrongAt: change.at }),
      );
      // 入っていない問題の削除は、何もしない操作になる(問い合わせて確かめる必要はない)
      await inChunks(change.correct, (id) => remove(sub, `${prefix}${id}`));
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
  };
}

/** 手元の開発とテスト用の、メモリ上の保存先。 */
export function createMemoryRepository(): HistoryRepository {
  const store = new Map<string, Map<string, Result>>();
  // 利用者と資格ごとの、問題 ID の集合
  const bookmarks = new Map<string, Set<string>>();
  const review = new Map<string, Set<string>>();
  // 利用者と資格ごとの、日付ごとの学習量と、目標日
  const days = new Map<string, Map<string, StudyDay>>();
  const goals = new Map<string, string>();
  const scope = (sub: string, examCode: string) => `${userKey(sub)}|${examCode}`;
  const setOf = (sets: Map<string, Set<string>>, sub: string, examCode: string) => {
    const key = scope(sub, examCode);
    const found = sets.get(key) ?? new Set<string>();
    sets.set(key, found);
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
      for (const old of sorted(sub, result.examCode).slice(MAX_RESULTS)) own.delete(resultKey(old));
    },
    async listResults(sub, examCode) {
      return sorted(sub, examCode).slice(0, MAX_RESULTS);
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
      return [...setOf(review, sub, examCode)].sort();
    },
    async updateReview(sub, examCode, change) {
      const own = setOf(review, sub, examCode);
      for (const id of change.wrong) own.add(id);
      for (const id of change.correct) own.delete(id);
    },
    async listDays(sub, examCode) {
      return [...(days.get(scope(sub, examCode))?.values() ?? [])].sort((a, b) => (a.date < b.date ? -1 : 1));
    },
    async getGoal(sub, examCode) {
      return goals.get(scope(sub, examCode)) ?? null;
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
