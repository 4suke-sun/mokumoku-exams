import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { MAX_RESULTS, type Result, ResultSchema } from "@/lib/storage.ts";

/** 履歴の保存先。利用者の識別子(`sub`)は、検証済みのものだけを渡す。 */
export interface HistoryRepository {
  /** 結果を保存する(同じ資格・同じ完了時刻は上書きなので、繰り返しても重複しない)。古いものは `MAX_RESULTS` 件までに切り詰める。 */
  putResult(sub: string, result: Result): Promise<void>;
  /** 資格の結果を新しい順に返す。 */
  listResults(sub: string, examCode: string): Promise<Result[]>;
}

/** DynamoDB のキー。単一テーブルで、PK=USER#{sub}、SK で種別を分ける。 */
export const userKey = (sub: string) => `USER#${sub}`;
export const resultKeyPrefix = (examCode: string) => `RESULT#${examCode}#`;
export const resultKey = (result: Pick<Result, "examCode" | "finishedAt">) =>
  `${resultKeyPrefix(result.examCode)}${result.finishedAt}`;

/** DynamoDB のドキュメントクライアントの、使う操作だけ(テストで差し替える) */
export type DocumentSender = { send(command: unknown): Promise<unknown> };

type QueryOutput = { Items?: Record<string, unknown>[] };

export function createDynamoRepository(options: { tableName: string; client: DocumentSender }): HistoryRepository {
  const { tableName, client } = options;

  const query = (sub: string, examCode: string, extra: { limit?: number; keysOnly?: boolean }) =>
    client.send(
      new QueryCommand({
        TableName: tableName,
        KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":pk": userKey(sub), ":prefix": resultKeyPrefix(examCode) },
        // 完了時刻の新しい順
        ScanIndexForward: false,
        ...(extra.limit ? { Limit: extra.limit } : {}),
        ...(extra.keysOnly ? { ProjectionExpression: "SK" } : {}),
      }),
    ) as Promise<QueryOutput>;

  return {
    async putResult(sub, result) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: userKey(sub), SK: resultKey(result), type: "result", ...result },
        }),
      );
      // 古いものを切り詰める(1 資格あたり高々 MAX_RESULTS + 数件なので、1 回の問い合わせで足りる)
      const { Items = [] } = await query(sub, result.examCode, { keysOnly: true });
      for (const item of Items.slice(MAX_RESULTS)) {
        await client.send(new DeleteCommand({ TableName: tableName, Key: { PK: userKey(sub), SK: item.SK } }));
      }
    },

    async listResults(sub, examCode) {
      const { Items = [] } = await query(sub, examCode, { limit: MAX_RESULTS });
      const results: Result[] = [];
      for (const item of Items) {
        // 保存した項目から、結果の部分だけを取り出して検査する(壊れた項目は、ないものとして扱う)
        const parsed = ResultSchema.safeParse({
          examCode: item.examCode,
          questionIds: item.questionIds,
          answers: item.answers,
          finishedAt: item.finishedAt,
          choiceOrder: item.choiceOrder,
        });
        if (parsed.success) results.push(parsed.data);
      }
      return results;
    },
  };
}

/** 手元の開発とテスト用の、メモリ上の保存先。 */
export function createMemoryRepository(): HistoryRepository {
  const store = new Map<string, Map<string, Result>>();
  const sorted = (sub: string, examCode: string) =>
    [...(store.get(userKey(sub))?.values() ?? [])]
      .filter((r) => r.examCode === examCode)
      .sort((a, b) => (a.finishedAt < b.finishedAt ? 1 : a.finishedAt > b.finishedAt ? -1 : 0));
  return {
    async putResult(sub, result) {
      const own = store.get(userKey(sub)) ?? new Map<string, Result>();
      own.set(resultKey(result), result);
      store.set(userKey(sub), own);
      for (const old of sorted(sub, result.examCode).slice(MAX_RESULTS)) own.delete(resultKey(old));
    },
    async listResults(sub, examCode) {
      return sorted(sub, examCode).slice(0, MAX_RESULTS);
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
