import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, PutCommand, QueryCommand } from "@aws-sdk/lib-dynamodb";
import { type DocumentSender, userKey } from "@/lib/history/repository.ts";
import { PUSH_KEY_PREFIX, pushKey } from "./endpoint.ts";
import type { PushTarget } from "./send.ts";

/** 通知の購読の保存先。履歴と同じテーブルの、利用者の区画(`PK=USER#{sub}`)に置く。`sub` は検証済みのものだけを渡す。 */
export interface PushRepository {
  /** 自分の購読を返す。 */
  listSubscriptions(sub: string): Promise<PushTarget[]>;
  /** 購読を保存する(同じ endpoint は上書き)。 */
  putSubscription(sub: string, target: PushTarget, createdAt: string): Promise<void>;
  /** 購読を消す(ないものを消しても、何もしない)。 */
  deleteSubscription(sub: string, endpoint: string): Promise<void>;
}

type QueryOutput = { Items?: Record<string, unknown>[] };

const targetOf = (item: Record<string, unknown>): PushTarget | null =>
  typeof item.endpoint === "string" && typeof item.p256dh === "string" && typeof item.auth === "string"
    ? { endpoint: item.endpoint, p256dh: item.p256dh, auth: item.auth }
    : null;

export function createDynamoPushRepository(options: { tableName: string; client: DocumentSender }): PushRepository {
  const { tableName, client } = options;
  return {
    async listSubscriptions(sub) {
      const { Items = [] } = (await client.send(
        new QueryCommand({
          TableName: tableName,
          KeyConditionExpression: "PK = :pk AND begins_with(SK, :prefix)",
          ExpressionAttributeValues: { ":pk": userKey(sub), ":prefix": PUSH_KEY_PREFIX },
        }),
      )) as QueryOutput;
      return Items.map(targetOf).filter((target): target is PushTarget => target !== null);
    },

    async putSubscription(sub, target, createdAt) {
      await client.send(
        new PutCommand({
          TableName: tableName,
          Item: { PK: userKey(sub), SK: pushKey(target.endpoint), type: "push", ...target, createdAt },
        }),
      );
    },

    async deleteSubscription(sub, endpoint) {
      await client.send(new DeleteCommand({ TableName: tableName, Key: { PK: userKey(sub), SK: pushKey(endpoint) } }));
    },
  };
}

/** 手元の開発とテスト用の、メモリ上の保存先。 */
export function createMemoryPushRepository(): PushRepository {
  const store = new Map<string, Map<string, PushTarget>>();
  const own = (sub: string) => {
    const found = store.get(userKey(sub)) ?? new Map<string, PushTarget>();
    store.set(userKey(sub), found);
    return found;
  };
  return {
    async listSubscriptions(sub) {
      return [...own(sub).values()];
    },
    async putSubscription(sub, target) {
      own(sub).set(pushKey(target.endpoint), target);
    },
    async deleteSubscription(sub, endpoint) {
      own(sub).delete(pushKey(endpoint));
    },
  };
}

const shared = globalThis as typeof globalThis & { __mokumokuFakePush?: PushRepository };
let dynamo: { key: string; repository: PushRepository } | undefined;

/** 購読の保存先を選ぶ。本番は DynamoDB(履歴のテーブル)。手元の開発だけ、`AUTH_FAKE=1` でメモリ上の代替にする。 */
export function getPushRepository(env: NodeJS.ProcessEnv = process.env): PushRepository {
  if (env.NODE_ENV !== "production" && env.AUTH_FAKE === "1") {
    shared.__mokumokuFakePush ??= createMemoryPushRepository();
    return shared.__mokumokuFakePush;
  }
  const { HISTORY_TABLE_NAME: tableName, AWS_REGION: region } = env;
  if (!tableName || !region) throw new Error("履歴の設定(HISTORY_TABLE_NAME / AWS_REGION)がありません。");
  const key = `${region}/${tableName}`;
  if (dynamo?.key !== key) {
    const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
    dynamo = { key, repository: createDynamoPushRepository({ tableName, client }) };
  }
  return dynamo.repository;
}
