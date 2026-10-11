import { describe, expect, it } from "vitest";
import { fakeTable } from "@/lib/history/table-double.ts";
import { pushKey } from "./endpoint.ts";
import { createDynamoPushRepository, getPushRepository } from "./repository.ts";

const target = (n: number) => ({ endpoint: `https://fcm.googleapis.com/fcm/send/device-${n}`, p256dh: "p", auth: "a" });

describe("DynamoDB の購読", () => {
  it("保存する_PK は利用者の sub で_SK は endpoint のハッシュになる", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoPushRepository({ tableName: "table-example", client });
    await repository.putSubscription("user-a", target(1), "2026-10-11T00:00:00.000Z");
    const [item] = [...items.values()];
    expect(item).toEqual({
      PK: "USER#user-a",
      SK: pushKey(target(1).endpoint),
      type: "push",
      ...target(1),
      createdAt: "2026-10-11T00:00:00.000Z",
    });
  });

  it("取得する_自分の購読だけを返し_ほかの種類の項目は混ざらない", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoPushRepository({ tableName: "table-example", client });
    await repository.putSubscription("user-a", target(1), "t");
    await repository.putSubscription("user-b", target(2), "t");
    items.set("USER#user-a|BOOKMARK#SAMPLE#SAMPLE-0001", { PK: "USER#user-a", SK: "BOOKMARK#SAMPLE#SAMPLE-0001" });
    expect(await repository.listSubscriptions("user-a")).toEqual([target(1)]);
  });

  it("消す_自分の区画の購読だけが消える", async () => {
    const { client } = fakeTable();
    const repository = createDynamoPushRepository({ tableName: "table-example", client });
    await repository.putSubscription("user-a", target(1), "t");
    await repository.putSubscription("user-b", target(1), "t");
    await repository.deleteSubscription("user-b", target(1).endpoint);
    expect(await repository.listSubscriptions("user-a")).toEqual([target(1)]);
    expect(await repository.listSubscriptions("user-b")).toEqual([]);
  });
});

describe("getPushRepository", () => {
  it("本番の設定では_代替の指定があっても DynamoDB を使い_設定がなければ失敗する", () => {
    expect(() => getPushRepository({ NODE_ENV: "production", AUTH_FAKE: "1" } as NodeJS.ProcessEnv)).toThrow(
      /HISTORY_TABLE_NAME/,
    );
  });
});
