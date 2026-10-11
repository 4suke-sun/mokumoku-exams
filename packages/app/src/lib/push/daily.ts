import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DeleteCommand, DynamoDBDocumentClient, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { isPushServiceEndpoint, PUSH_KEY_PREFIX } from "./endpoint.ts";
import {
  DAILY_MESSAGE,
  DAILY_TTL_SECONDS,
  type PushSender,
  type PushTarget,
  sendToAll,
  webPushSender,
} from "./send.ts";
import { readVapid, VapidKeyUnavailableError } from "./vapid.ts";

// 毎日のスケジュールで動く Lambda(packages/infra の PushStack)。購読しているすべての端末に、リマインドを送る。
// Lambda にも載せるため、`@/` を使わない(endpoint.ts を参照)。

/** DynamoDB のドキュメントクライアントの、使う操作だけ(テストで差し替える) */
export type DocumentSender = { send(command: unknown): Promise<unknown> };

/** テーブルの購読。消すときのために、キーも持つ。 */
export type StoredTarget = PushTarget & { PK: string; SK: string };

type ScanOutput = { Items?: Record<string, unknown>[]; LastEvaluatedKey?: Record<string, unknown> };

/**
 * 購読をすべて集める。利用者をまたいで集めるため、ここだけはスキャンを使う(SK が `PUSH#` の項目だけを返す)。
 * 形の合わない項目と、既知のプッシュサービスでない endpoint は、送り先にしない。
 */
export async function scanSubscriptions(client: DocumentSender, tableName: string): Promise<StoredTarget[]> {
  const found: StoredTarget[] = [];
  let startKey: Record<string, unknown> | undefined;
  do {
    const output = (await client.send(
      new ScanCommand({
        TableName: tableName,
        FilterExpression: "begins_with(#sk, :prefix)",
        ProjectionExpression: "#pk, #sk, #endpoint, #p256dh, #auth",
        ExpressionAttributeNames: {
          "#pk": "PK",
          "#sk": "SK",
          "#endpoint": "endpoint",
          "#p256dh": "p256dh",
          "#auth": "auth",
        },
        ExpressionAttributeValues: { ":prefix": PUSH_KEY_PREFIX },
        ...(startKey ? { ExclusiveStartKey: startKey } : {}),
      }),
    )) as ScanOutput;
    for (const item of output.Items ?? []) {
      const { PK, SK, endpoint, p256dh, auth } = item;
      if (
        typeof PK === "string" &&
        typeof SK === "string" &&
        SK.startsWith(PUSH_KEY_PREFIX) &&
        typeof endpoint === "string" &&
        isPushServiceEndpoint(endpoint) &&
        typeof p256dh === "string" &&
        typeof auth === "string"
      ) {
        found.push({ PK, SK, endpoint, p256dh, auth });
      }
    }
    startKey = output.LastEvaluatedKey;
  } while (startKey);
  return found;
}

/** 毎日の通知を送り、無効になった購読を消す。数だけを返す(endpoint などは返さない)。 */
export async function runDaily(deps: {
  client: DocumentSender;
  tableName: string;
  send: PushSender;
}): Promise<DailyResult> {
  const targets = await scanSubscriptions(deps.client, deps.tableName);
  const summary = await sendToAll(targets, DAILY_MESSAGE, deps.send);
  for (const target of summary.gone as StoredTarget[]) {
    // 購読の項目だけを消す(条件で、ほかの種類の項目を消さないことを確かめる)
    await deps.client.send(
      new DeleteCommand({
        TableName: deps.tableName,
        Key: { PK: target.PK, SK: target.SK },
        ConditionExpression: "begins_with(SK, :prefix)",
        ExpressionAttributeValues: { ":prefix": PUSH_KEY_PREFIX },
      }),
    );
  }
  return { sent: summary.sent, failed: summary.failed, gone: summary.gone.length };
}

type DailyResult = { sent: number; failed: number; gone: number };

/**
 * 毎日の通知を送り、結果をログに記録する。記録するのは数だけ(endpoint は個人に紐づくため、ログに出さない)。
 * 秘密鍵を読めないときは、数ではなく、その種類だけを記録して失敗にする(値も原因も出さない)。
 */
export async function runDailyAndLog(
  deps: Parameters<typeof runDaily>[0],
  log: (line: string) => void = (line) => console.log(line),
): Promise<DailyResult> {
  let result: DailyResult;
  try {
    result = await runDaily(deps);
  } catch (error) {
    if (!(error instanceof VapidKeyUnavailableError)) throw error;
    log(JSON.stringify({ message: "daily push", error: "vapid-key-unavailable" }));
    throw new VapidKeyUnavailableError();
  }
  log(JSON.stringify({ message: "daily push", ...result }));
  return result;
}

/** Lambda の入り口。設定がなければ失敗にする(アラームやログで気付けるように)。 */
export async function handler(): Promise<DailyResult> {
  const vapid = readVapid(process.env);
  const { HISTORY_TABLE_NAME: tableName, AWS_REGION: region } = process.env;
  if (!vapid || !tableName || !region)
    throw new Error("通知の設定(VAPID_* / HISTORY_TABLE_NAME / AWS_REGION)がありません。");
  const client = DynamoDBDocumentClient.from(new DynamoDBClient({ region }));
  return runDailyAndLog({ client, tableName, send: webPushSender(vapid, DAILY_TTL_SECONDS) });
}
