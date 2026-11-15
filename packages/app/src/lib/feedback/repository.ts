import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { type DocumentSender, userKey } from "@/lib/history/repository.ts";

/** 送信の回数のソートキーの接頭辞。`SK=FEEDBACK#{YYYY-MM-DD}`(日本時間の日付) */
export const FEEDBACK_KEY_PREFIX = "FEEDBACK#";

export const feedbackKey = (day: string) => `${FEEDBACK_KEY_PREFIX}${day}`;

/** 日本時間の日付(`YYYY-MM-DD`) */
export function tokyoDay(nowMs: number): string {
  return new Date(nowMs + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * 送信の回数の保存先。履歴と同じテーブルの、利用者の区画(`PK=USER#{sub}`)に置く。退会では、区画ごと消える(`deleteUserData`)。
 * `sub` は検証済みのものだけを渡す。
 */
export interface FeedbackRepository {
  /** その日の回数を 1 増やす。上限に達していれば増やさず、false を返す。 */
  consume(sub: string, day: string, limit: number): Promise<boolean>;
  /** 増やした 1 を戻す(起票に失敗したとき)。 */
  refund(sub: string, day: string): Promise<void>;
}

export function createDynamoFeedbackRepository(options: {
  tableName: string;
  client: DocumentSender;
}): FeedbackRepository {
  const { tableName, client } = options;
  return {
    async consume(sub, day, limit) {
      try {
        await client.send(
          new UpdateCommand({
            TableName: tableName,
            Key: { PK: userKey(sub), SK: feedbackKey(day) },
            UpdateExpression: "SET #type = :type ADD #count :one",
            ConditionExpression: "attribute_not_exists(#count) OR #count < :limit",
            ExpressionAttributeNames: { "#type": "type", "#count": "count" },
            ExpressionAttributeValues: { ":type": "feedback", ":one": 1, ":limit": limit },
          }),
        );
        return true;
      } catch (error) {
        if ((error as { name?: unknown } | null)?.name === "ConditionalCheckFailedException") return false;
        throw error;
      }
    },

    async refund(sub, day) {
      await client.send(
        new UpdateCommand({
          TableName: tableName,
          Key: { PK: userKey(sub), SK: feedbackKey(day) },
          UpdateExpression: "ADD #count :minus",
          ConditionExpression: "#count > :zero",
          ExpressionAttributeNames: { "#count": "count" },
          ExpressionAttributeValues: { ":minus": -1, ":zero": 0 },
        }),
      );
    },
  };
}

/** 手元の開発とテスト用の、メモリ上の保存先。 */
export function createMemoryFeedbackRepository(): FeedbackRepository {
  const counts = new Map<string, number>();
  const key = (sub: string, day: string) => `${userKey(sub)}|${feedbackKey(day)}`;
  return {
    async consume(sub, day, limit) {
      const current = counts.get(key(sub, day)) ?? 0;
      if (current >= limit) return false;
      counts.set(key(sub, day), current + 1);
      return true;
    },
    async refund(sub, day) {
      const current = counts.get(key(sub, day)) ?? 0;
      if (current > 0) counts.set(key(sub, day), current - 1);
    },
  };
}

const shared = globalThis as typeof globalThis & { __mokumokuFakeFeedback?: FeedbackRepository };
let dynamo: { key: string; repository: FeedbackRepository } | undefined;

/** 回数の保存先を選ぶ。本番は DynamoDB(履歴のテーブル)。手元の開発だけ、`AUTH_FAKE=1` でメモリ上の代替にする。 */
export function getFeedbackRepository(env: NodeJS.ProcessEnv = process.env): FeedbackRepository {
  if (env.NODE_ENV !== "production" && env.AUTH_FAKE === "1") {
    shared.__mokumokuFakeFeedback ??= createMemoryFeedbackRepository();
    return shared.__mokumokuFakeFeedback;
  }
  const { HISTORY_TABLE_NAME: tableName, AWS_REGION: region } = env;
  if (!tableName || !region) throw new Error("履歴の設定(HISTORY_TABLE_NAME / AWS_REGION)がありません。");
  const key = `${region}/${tableName}`;
  if (dynamo?.key !== key) {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    dynamo = { key, repository: createDynamoFeedbackRepository({ tableName, client }) };
  }
  return dynamo.repository;
}
