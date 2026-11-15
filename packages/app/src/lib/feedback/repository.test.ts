import { UpdateCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import type { DocumentSender } from "@/lib/history/repository.ts";
import {
  createDynamoFeedbackRepository,
  createMemoryFeedbackRepository,
  type FeedbackRepository,
  tokyoDay,
} from "./repository.ts";

/** 回数の更新(条件つきの ADD)だけを真似る、DynamoDB の代わり */
function countingTable() {
  const counts = new Map<string, number>();
  const sent: UpdateCommand[] = [];
  const client: DocumentSender = {
    async send(command) {
      if (!(command instanceof UpdateCommand)) throw new Error("unexpected command");
      sent.push(command);
      const { Key, ExpressionAttributeValues: values = {} } = command.input;
      const key = `${Key?.PK}|${Key?.SK}`;
      const current = counts.get(key);
      const delta = Number(values[":one"] ?? values[":minus"]);
      const allowed =
        ":limit" in values ? current === undefined || current < Number(values[":limit"]) : (current ?? 0) > 0;
      if (!allowed) throw Object.assign(new Error("条件に合いません"), { name: "ConditionalCheckFailedException" });
      counts.set(key, (current ?? 0) + delta);
      return {};
    },
  };
  return { client, counts, sent };
}

describe("tokyoDay", () => {
  it("UTC の 15 時より前と後_日本時間の日付になる", () => {
    expect(tokyoDay(Date.parse("2026-11-15T14:59:59Z"))).toBe("2026-11-15");
    expect(tokyoDay(Date.parse("2026-11-15T15:00:00Z"))).toBe("2026-11-16");
  });
});

const cases: [string, () => { repository: FeedbackRepository }][] = [
  ["メモリ", () => ({ repository: createMemoryFeedbackRepository() })],
  [
    "DynamoDB",
    () => ({ repository: createDynamoFeedbackRepository({ tableName: "t", client: countingTable().client }) }),
  ],
];

describe.each(cases)("回数の保存先(%s)", (_, make) => {
  it("上限まで_増やせて_上限を超える 1 件は断られる", async () => {
    const { repository } = make();
    for (let i = 0; i < 3; i++) expect(await repository.consume("user-a", "2026-11-15", 3)).toBe(true);
    expect(await repository.consume("user-a", "2026-11-15", 3)).toBe(false);
  });

  it("戻した 1_もう一度送れる", async () => {
    const { repository } = make();
    expect(await repository.consume("user-a", "2026-11-15", 1)).toBe(true);
    await repository.refund("user-a", "2026-11-15");
    expect(await repository.consume("user-a", "2026-11-15", 1)).toBe(true);
  });

  it("別の日と別の利用者_別に数える", async () => {
    const { repository } = make();
    expect(await repository.consume("user-a", "2026-11-15", 1)).toBe(true);
    expect(await repository.consume("user-a", "2026-11-16", 1)).toBe(true);
    expect(await repository.consume("user-b", "2026-11-15", 1)).toBe(true);
  });
});

describe("createDynamoFeedbackRepository", () => {
  it("回数を増やす_利用者の区画の FEEDBACK# の項目を_上限の条件つきで更新する", async () => {
    const table = countingTable();
    const repository = createDynamoFeedbackRepository({ tableName: "t", client: table.client });
    await repository.consume("user-a", "2026-11-15", 10);
    const input = table.sent[0]?.input;
    expect(input?.Key).toEqual({ PK: "USER#user-a", SK: "FEEDBACK#2026-11-15" });
    expect(input?.ConditionExpression).toBe("attribute_not_exists(#count) OR #count < :limit");
    expect(input?.ExpressionAttributeValues?.[":limit"]).toBe(10);
  });

  it("条件以外の失敗_例外をそのまま投げる", async () => {
    const client: DocumentSender = {
      async send() {
        throw Object.assign(new Error("x"), { name: "ProvisionedThroughputExceededException" });
      },
    };
    const repository = createDynamoFeedbackRepository({ tableName: "t", client });
    await expect(repository.consume("user-a", "2026-11-15", 10)).rejects.toThrow();
  });
});
