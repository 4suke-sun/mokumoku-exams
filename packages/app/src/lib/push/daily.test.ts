import { DeleteCommand, type ScanCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it, vi } from "vitest";
import { fakeTable } from "@/lib/history/table-double.ts";
import { runDaily, runDailyAndLog, scanSubscriptions } from "./daily.ts";
import { pushKey } from "./endpoint.ts";
import { DAILY_MESSAGE, type PushSender, type SendOutcome, webPushSender } from "./send.ts";
import { VapidKeyUnavailableError } from "./vapid.ts";

const endpointOf = (n: number) => `https://fcm.googleapis.com/fcm/send/device-${n}`;

function seed(
  items: Map<string, Record<string, unknown>>,
  sub: string,
  n: number,
  extra: Record<string, unknown> = {},
) {
  const item = {
    PK: `USER#${sub}`,
    SK: pushKey(endpointOf(n)),
    type: "push",
    endpoint: endpointOf(n),
    p256dh: "p",
    auth: "a",
    ...extra,
  };
  items.set(`${item.PK}|${item.SK}`, item);
}

function sender(outcomes: Record<string, SendOutcome> = {}) {
  const sent: string[] = [];
  const send: PushSender = async (target, payload) => {
    sent.push(target.endpoint);
    expect(JSON.parse(payload)).toEqual(DAILY_MESSAGE);
    return outcomes[target.endpoint] ?? "sent";
  };
  return { sent, send };
}

describe("毎日の通知", () => {
  it("利用者をまたいで購読を集め_購読でない項目は送り先にしない", async () => {
    const { items, client } = fakeTable({ scanPageSize: 2 });
    seed(items, "user-a", 1);
    seed(items, "user-b", 2);
    seed(items, "user-c", 3);
    items.set("USER#user-a|RESULT#SAMPLE#2026-10-11T00:00:00.000Z", {
      PK: "USER#user-a",
      SK: "RESULT#SAMPLE#2026-10-11T00:00:00.000Z",
      endpoint: endpointOf(9),
    });
    const found = await scanSubscriptions(client, "table-example");
    expect(found.map((t) => t.endpoint).sort()).toEqual([endpointOf(1), endpointOf(2), endpointOf(3)]);
  });

  it("形の合わない項目と_既知のプッシュサービスでない endpoint は_送り先にしない", async () => {
    const { items, client } = fakeTable();
    seed(items, "user-a", 1);
    seed(items, "user-b", 2, { endpoint: "https://example.com/push" });
    seed(items, "user-c", 3, { auth: 1 });
    const found = await scanSubscriptions(client, "table-example");
    expect(found.map((t) => t.endpoint)).toEqual([endpointOf(1)]);
  });

  it("全員に送り_無効になった購読だけを消し_ほかの項目は残す", async () => {
    const { items, client, sent: commands } = fakeTable();
    seed(items, "user-a", 1);
    seed(items, "user-b", 2);
    items.set("USER#user-b|BOOKMARK#SAMPLE#SAMPLE-0001", { PK: "USER#user-b", SK: "BOOKMARK#SAMPLE#SAMPLE-0001" });
    const { sent, send } = sender({ [endpointOf(2)]: "gone" });

    const result = await runDaily({ client, tableName: "table-example", send });

    expect(result).toEqual({ sent: 1, failed: 0, gone: 1 });
    expect(sent.sort()).toEqual([endpointOf(1), endpointOf(2)]);
    expect([...items.keys()].sort()).toEqual(
      [`USER#user-a|${pushKey(endpointOf(1))}`, "USER#user-b|BOOKMARK#SAMPLE#SAMPLE-0001"].sort(),
    );
    const deletes = commands.filter((c) => c instanceof DeleteCommand) as DeleteCommand[];
    expect(deletes).toHaveLength(1);
    expect(deletes[0]?.input.ConditionExpression).toBe("begins_with(SK, :prefix)");
  });

  it("送れなかった購読_消さずに残す(次の日にまた送る)", async () => {
    const { items, client } = fakeTable();
    seed(items, "user-a", 1);
    const result = await runDaily({
      client,
      tableName: "table-example",
      send: sender({ [endpointOf(1)]: "failed" }).send,
    });
    expect(result).toEqual({ sent: 0, failed: 1, gone: 0 });
    expect(items.size).toBe(1);
  });

  it("スキャンは_SK が PUSH# の項目に絞り_必要な属性だけを読む", async () => {
    const { client, sent: commands } = fakeTable();
    await scanSubscriptions(client, "table-example");
    const [scan] = commands as ScanCommand[];
    expect(scan?.input.FilterExpression).toBe("begins_with(#sk, :prefix)");
    expect(scan?.input.ExpressionAttributeValues).toEqual({ ":prefix": "PUSH#" });
    expect(scan?.input.ProjectionExpression).toBe("#pk, #sk, #endpoint, #p256dh, #auth");
  });

  it("結果のログは_数だけを記録する", async () => {
    const { items, client } = fakeTable();
    seed(items, "user-a", 1);
    const log = vi.fn();
    await runDailyAndLog({ client, tableName: "table-example", send: sender().send }, log);
    expect(log.mock.calls).toEqual([[JSON.stringify({ message: "daily push", sent: 1, failed: 0, gone: 0 })]]);
  });

  it("秘密鍵を読めない_数ではなく種類だけを記録して失敗にし_購読を消さない", async () => {
    const { items, client } = fakeTable();
    seed(items, "user-a", 1);
    const parameter = "/example/push/vapid-private-key";
    const send = webPushSender(
      { publicKey: "P".repeat(87), privateKeyParameter: parameter, subject: "mailto:admin@example.com" },
      60,
      async () => {
        throw new Error(`AccessDenied: ${parameter}`);
      },
    );
    const log = vi.fn();
    const failure = await runDailyAndLog({ client, tableName: "table-example", send }, log).catch(
      (error: unknown) => error,
    );
    expect(failure).toBeInstanceOf(VapidKeyUnavailableError);
    expect((failure as Error).message).not.toContain(parameter);
    expect(log.mock.calls).toEqual([[JSON.stringify({ message: "daily push", error: "vapid-key-unavailable" })]]);
    expect(items.size).toBe(1);
  });
});
