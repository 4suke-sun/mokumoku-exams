import { DeleteCommand, GetCommand, PutCommand, ScanCommand } from "@aws-sdk/lib-dynamodb";
import { describe, expect, it } from "vitest";
import { applyMigration, planMigration, renameSortKey } from "./migrate-exam-codes.ts";

const mapping = { AIB: "AWS-AIB-C01" };

/** DynamoDB の Scan / Get / Put / Delete だけを、メモリ上で真似る(1 ページ 2 件で返し、ページ送りも確かめる) */
function fakeTable() {
  const items = new Map<string, Record<string, unknown>>();
  const id = (key: Record<string, unknown>) => `${key.PK}|${key.SK}`;
  const client = {
    async send(command: unknown) {
      if (command instanceof ScanCommand) {
        const all = [...items.values()];
        const start = command.input.ExclusiveStartKey ? Number(command.input.ExclusiveStartKey.offset) : 0;
        const page = all.slice(start, start + 2);
        return { Items: page, ...(start + 2 < all.length ? { LastEvaluatedKey: { offset: start + 2 } } : {}) };
      }
      if (command instanceof GetCommand) return { Item: items.get(id(command.input.Key as Record<string, unknown>)) };
      if (command instanceof PutCommand) {
        const item = command.input.Item as Record<string, unknown>;
        if (command.input.ConditionExpression === "attribute_not_exists(PK)" && items.has(id(item))) {
          throw Object.assign(new Error("conditional"), { name: "ConditionalCheckFailedException" });
        }
        items.set(id(item), item);
      }
      if (command instanceof DeleteCommand) items.delete(id(command.input.Key as Record<string, unknown>));
      return {};
    },
  };
  return { items, client };
}

describe("renameSortKey", () => {
  it("旧コードの SK_新コードの SK にする", () => {
    expect(renameSortKey("RESULT#AIB#2026-10-01T00:00:00.000Z", mapping)).toEqual({
      to: "RESULT#AWS-AIB-C01#2026-10-01T00:00:00.000Z",
      kind: "RESULT",
    });
    expect(renameSortKey("GOAL#AIB", mapping)).toEqual({ to: "GOAL#AWS-AIB-C01", kind: "GOAL" });
    expect(renameSortKey("SECTIONS#AIB", mapping)?.to).toBe("SECTIONS#AWS-AIB-C01");
    expect(renameSortKey("BOOKMARK#AIB#AIB-0001", mapping)?.to).toBe("BOOKMARK#AWS-AIB-C01#AIB-0001");
    expect(renameSortKey("NOTEBOOK#AIB#domain1-1", mapping)).toEqual({
      to: "NOTEBOOK#AWS-AIB-C01#domain1-1",
      kind: "NOTEBOOK",
    });
  });

  it("対象でない SK_null(コードの一部が同じだけのもの、表示の設定、通知の購読)", () => {
    for (const sk of ["PREFS", "PUSH#abc", "RESULT#AIBX#t", "RESULT#XAIB#t", "GOAL#AIBX", "RESULT#AWS-AIB-C01#t"]) {
      expect(renameSortKey(sk, mapping), sk).toBeNull();
    }
  });
});

describe("DynamoDB の移行", () => {
  const seed = () => {
    const table = fakeTable();
    const put = (pk: string, sk: string, extra: Record<string, unknown> = {}) =>
      table.items.set(`${pk}|${sk}`, { PK: pk, SK: sk, ...extra });
    put("USER#a", "RESULT#AIB#2026-10-01T00:00:00.000Z", {
      type: "result",
      examCode: "AIB",
      questionIds: ["AIB-0001"],
    });
    put("USER#a", "REVIEW#AIB#AIB-0001", { type: "review", examCode: "AIB", streak: 1 });
    put("USER#a", "GOAL#AIB", { type: "goal", examCode: "AIB", date: "2026-12-01" });
    put("USER#b", "SECTIONS#AIB", { type: "sections", examCode: "AIB", best: {} });
    put("USER#b", "NOTEBOOK#AIB#domain1-1", { type: "notebook", examCode: "AIB", unit: "domain1-1" });
    put("USER#a", "PREFS", { type: "prefs" });
    put("USER#a", "RESULT#AWS-AIB-C01#2026-10-02T00:00:00.000Z", { type: "result", examCode: "AWS-AIB-C01" });
    return table;
  };

  it("確認_件数だけ数え_何も書かない", async () => {
    const { client, items } = seed();
    const before = new Map(items);
    const plan = await planMigration(client, "table-example", mapping);
    expect(plan.moves).toHaveLength(5);
    expect(plan.counts).toMatchObject({ RESULT: 1, REVIEW: 1, GOAL: 1, SECTIONS: 1, NOTEBOOK: 1 });
    expect(plan.conflicts).toBe(0);
    expect(items).toEqual(before);
  });

  it("実行_新コードの SK に写し_項目の中のコードも新しくし_旧い項目を消す", async () => {
    const { client, items } = seed();
    const plan = await planMigration(client, "table-example", mapping);
    expect(await applyMigration(client, "table-example", mapping, plan)).toEqual({ moved: 5, conflicts: 0 });
    expect(items.has("USER#a|RESULT#AIB#2026-10-01T00:00:00.000Z")).toBe(false);
    expect(items.get("USER#a|RESULT#AWS-AIB-C01#2026-10-01T00:00:00.000Z")).toMatchObject({
      examCode: "AWS-AIB-C01",
      questionIds: ["AIB-0001"],
    });
    expect(items.get("USER#a|REVIEW#AWS-AIB-C01#AIB-0001")).toMatchObject({ streak: 1, examCode: "AWS-AIB-C01" });
    expect(items.get("USER#b|SECTIONS#AWS-AIB-C01")).toBeDefined();
    expect(items.get("USER#b|NOTEBOOK#AWS-AIB-C01#domain1-1")).toMatchObject({ examCode: "AWS-AIB-C01" });
    expect(items.get("USER#a|PREFS")).toBeDefined();
  });

  it("もう一度実行_対象がなく_結果は変わらない", async () => {
    const { client, items } = seed();
    await applyMigration(client, "table-example", mapping, await planMigration(client, "table-example", mapping));
    const after = new Map(items);
    const again = await planMigration(client, "table-example", mapping);
    expect(again.moves).toEqual([]);
    expect(items).toEqual(after);
  });

  it("計画のあとに新コードの SK へ項目が書かれた_上書きせず衝突として数え_旧い項目を残す", async () => {
    const { client, items } = seed();
    const plan = await planMigration(client, "table-example", mapping);
    items.set("USER#a|GOAL#AWS-AIB-C01", { PK: "USER#a", SK: "GOAL#AWS-AIB-C01", date: "2027-01-01" });
    const result = await applyMigration(client, "table-example", mapping, plan);
    expect(result).toEqual({ moved: 4, conflicts: 1 });
    expect(items.get("USER#a|GOAL#AWS-AIB-C01")).toMatchObject({ date: "2027-01-01" });
    expect(items.has("USER#a|GOAL#AIB")).toBe(true);
  });

  it("新コードの SK に項目がすでにある_上書きせず衝突として数える", async () => {
    const { client, items } = seed();
    items.set("USER#a|GOAL#AWS-AIB-C01", { PK: "USER#a", SK: "GOAL#AWS-AIB-C01", date: "2027-01-01" });
    const plan = await planMigration(client, "table-example", mapping);
    expect(plan.conflicts).toBe(1);
    await applyMigration(client, "table-example", mapping, plan);
    expect(items.get("USER#a|GOAL#AWS-AIB-C01")).toMatchObject({ date: "2027-01-01" });
    expect(items.has("USER#a|GOAL#AIB")).toBe(true);
  });
});
