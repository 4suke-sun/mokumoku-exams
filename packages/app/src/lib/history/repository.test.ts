import { describe, expect, it } from "vitest";
import { MAX_RESULTS, type Result } from "@/lib/storage.ts";
import {
  createDynamoRepository,
  createMemoryRepository,
  getHistoryRepository,
  resultKey,
  userKey,
} from "./repository.ts";
import { fakeTable } from "./table-double.ts";

const result = (examCode: string, minute: number, extra: Partial<Result> = {}): Result => ({
  examCode,
  questionIds: ["Q-0001", "Q-0002"],
  answers: { "Q-0001": ["A"] },
  finishedAt: new Date(Date.UTC(2026, 9, 11, 12, minute)).toISOString(),
  ...extra,
});

describe("DynamoDB の履歴", () => {
  it("結果を保存する_PK は利用者の sub で SK は資格コードと完了時刻になる", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    const saved = result("SAMPLE", 1);
    await repository.putResult("user-a", saved);
    const [item] = [...items.values()];
    expect(item?.PK).toBe("USER#user-a");
    expect(item?.SK).toBe(`RESULT#SAMPLE#${saved.finishedAt}`);
    expect(userKey("user-a")).toBe("USER#user-a");
    expect(resultKey(saved)).toBe(`RESULT#SAMPLE#${saved.finishedAt}`);
  });

  it("結果を取得する_自分の分だけを新しい順に返す", async () => {
    const { client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.putResult("user-a", result("SAMPLE", 1));
    await repository.putResult("user-a", result("SAMPLE", 3));
    await repository.putResult("user-b", result("SAMPLE", 2));
    const found = await repository.listResults("user-a", "SAMPLE");
    expect(found.map((r) => r.finishedAt)).toEqual([result("SAMPLE", 3).finishedAt, result("SAMPLE", 1).finishedAt]);
    expect(await repository.listResults("user-c", "SAMPLE")).toEqual([]);
  });

  it("資格コードが前方一致する別の資格_混ざらない", async () => {
    const { client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.putResult("user-a", result("EXAM1", 1));
    await repository.putResult("user-a", result("EXAM10", 2));
    expect((await repository.listResults("user-a", "EXAM1")).map((r) => r.examCode)).toEqual(["EXAM1"]);
  });

  it("同じ完了時刻の結果を繰り返し保存する_重複しない", async () => {
    const { client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.putResult("user-a", result("SAMPLE", 1));
    await repository.putResult("user-a", result("SAMPLE", 1));
    expect(await repository.listResults("user-a", "SAMPLE")).toHaveLength(1);
  });

  it("上限を超えて保存する_古いものから削除して上限の件数にする", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    for (let minute = 0; minute <= MAX_RESULTS; minute++)
      await repository.putResult("user-a", result("SAMPLE", minute));
    expect(items.size).toBe(MAX_RESULTS);
    const found = await repository.listResults("user-a", "SAMPLE");
    expect(found.at(-1)?.finishedAt).toBe(result("SAMPLE", 1).finishedAt);
  });

  it("保存した項目が壊れている_その項目は返さない", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    items.set("USER#user-a|RESULT#SAMPLE#2026-10-11T12:00:00.000Z", {
      PK: "USER#user-a",
      SK: "RESULT#SAMPLE#2026-10-11T12:00:00.000Z",
      examCode: "SAMPLE",
    });
    await repository.putResult("user-a", result("SAMPLE", 5));
    expect(await repository.listResults("user-a", "SAMPLE")).toHaveLength(1);
  });

  it("使う操作は_保存・問い合わせ・削除だけで_スキャンは使わない", async () => {
    const { sent, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    for (let minute = 0; minute <= MAX_RESULTS; minute++)
      await repository.putResult("user-a", result("SAMPLE", minute));
    await repository.listResults("user-a", "SAMPLE");
    const names = new Set(sent.map((c) => (c as { constructor: { name: string } }).constructor.name));
    expect([...names].sort()).toEqual(["DeleteCommand", "PutCommand", "QueryCommand"]);
  });
});

describe("DynamoDB のブックマークと復習プール", () => {
  it("ブックマーク_SK は資格と問題 ID で_自分の資格の分だけを返す", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.setBookmark("user-a", "SAMPLE", "SAMPLE-0002", true);
    await repository.setBookmark("user-a", "SAMPLE", "SAMPLE-0001", true);
    await repository.setBookmark("user-a", "SAMPLE2", "SAMPLE2-0001", true);
    await repository.setBookmark("user-b", "SAMPLE", "SAMPLE-0003", true);
    expect([...items.values()].map((i) => `${i.PK} ${i.SK}`)).toContain("USER#user-a BOOKMARK#SAMPLE#SAMPLE-0002");
    expect(await repository.listBookmarks("user-a", "SAMPLE")).toEqual(["SAMPLE-0001", "SAMPLE-0002"]);
    await repository.setBookmark("user-a", "SAMPLE", "SAMPLE-0001", false);
    expect(await repository.listBookmarks("user-a", "SAMPLE")).toEqual(["SAMPLE-0002"]);
  });

  it("復習プール_間違えた問題を入れ_正解した問題を外し_結果の項目とは混ざらない", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    await repository.putResult("user-a", result("SAMPLE", 1));
    const at = "2026-10-11T12:00:00.000Z";
    await repository.updateReview("user-a", "SAMPLE", { wrong: ["SAMPLE-0001", "SAMPLE-0002"], correct: [], at });
    await repository.updateReview("user-a", "SAMPLE", { wrong: [], correct: ["SAMPLE-0001", "SAMPLE-0003"], at });
    expect(await repository.listReview("user-a", "SAMPLE")).toEqual(["SAMPLE-0002"]);
    expect(await repository.listReview("user-b", "SAMPLE")).toEqual([]);
    expect(items.get("USER#user-a|REVIEW#SAMPLE#SAMPLE-0002")?.wrongAt).toBe(at);
    expect(await repository.listResults("user-a", "SAMPLE")).toHaveLength(1);
  });

  it("壊れた SK_問題 ID の形でないものは返さない", async () => {
    const { items, client } = fakeTable();
    const repository = createDynamoRepository({ tableName: "table-example", client });
    items.set("x", { PK: "USER#user-a", SK: "BOOKMARK#SAMPLE#broken" });
    expect(await repository.listBookmarks("user-a", "SAMPLE")).toEqual([]);
  });

  it("問題の多い結果_同時に送る書き込みは 10 件まで", async () => {
    let inFlight = 0;
    let peak = 0;
    const { client } = fakeTable();
    const slow = {
      async send(command: unknown) {
        inFlight++;
        peak = Math.max(peak, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 1));
        inFlight--;
        return client.send(command);
      },
    };
    const repository = createDynamoRepository({ tableName: "table-example", client: slow });
    const ids = Array.from({ length: 35 }, (_, i) => `SAMPLE-${String(i + 1).padStart(4, "0")}`);
    await repository.updateReview("user-a", "SAMPLE", { wrong: ids, correct: [], at: "2026-10-11T12:00:00.000Z" });
    expect(peak).toBe(10);
    expect(await repository.listReview("user-a", "SAMPLE")).toHaveLength(35);
  });
});

describe("メモリ上の履歴", () => {
  it("利用者ごとに分かれ_上限を超えると古いものを捨てる", async () => {
    const repository = createMemoryRepository();
    for (let minute = 0; minute <= MAX_RESULTS; minute++)
      await repository.putResult("user-a", result("SAMPLE", minute));
    await repository.putResult("user-b", result("SAMPLE", 0));
    expect(await repository.listResults("user-a", "SAMPLE")).toHaveLength(MAX_RESULTS);
    expect(await repository.listResults("user-b", "SAMPLE")).toHaveLength(1);
  });
});

describe("getHistoryRepository", () => {
  it("本番の設定では_AUTH_FAKE があってもメモリを使わず_設定が足りなければ失敗する", () => {
    expect(() => getHistoryRepository({ NODE_ENV: "production", AUTH_FAKE: "1" })).toThrow();
  });

  it("手元の開発で AUTH_FAKE=1 のとき_メモリ上の保存先を返す", async () => {
    const repository = getHistoryRepository({ NODE_ENV: "development", AUTH_FAKE: "1" });
    await repository.putResult("user-a", result("SAMPLE", 1));
    expect(await repository.listResults("user-a", "SAMPLE")).toHaveLength(1);
  });

  it("設定が揃っていれば_DynamoDB の実装を返す", () => {
    expect(
      getHistoryRepository({ NODE_ENV: "production", HISTORY_TABLE_NAME: "t", AWS_REGION: "us-east-1" }),
    ).toBeDefined();
  });
});
