import { describe, expect, it } from "vitest";
import { serviceSpread, spreadWarnings } from "./services.ts";

const SERVICES = ["AWS Lambda", "Amazon DynamoDB", "Amazon Simple Queue Service (Amazon SQS)"];

describe("束のサービスの分布", () => {
  const spread = serviceSpread(
    ["Lambda から DynamoDB に書く", "Lambda の同時実行", "SQS のキュー", "リージョンの選び方"],
    SERVICES,
  );

  it("問題の並び_サービスが出る割合と、2 つ以上出る割合を測る", () => {
    expect(spread.total).toBe(4);
    expect(spread.mentionedShare).toBe(0.75);
    expect(spread.multiShare).toBe(0.25);
  });

  it("出る問題の数_多い順に並べ、同数は一覧の順にし、出ないサービスは含めない", () => {
    expect(spread.ranking.map((r) => [r.service, r.count])).toEqual([
      ["AWS Lambda", 2],
      ["Amazon DynamoDB", 1],
      ["Amazon Simple Queue Service (Amazon SQS)", 1],
    ]);
    expect(spread.coveredServices).toBe(3);
    expect(serviceSpread(["DynamoDB"], SERVICES).ranking.map((r) => r.service)).toEqual(["Amazon DynamoDB"]);
  });

  it("問題が 0 件_割合は 0 にする", () => {
    expect(serviceSpread([], SERVICES)).toEqual({
      total: 0,
      mentionedShare: 0,
      multiShare: 0,
      coveredServices: 0,
      ranking: [],
    });
  });
});

describe("束のサービスの分布の目安", () => {
  const spread = serviceSpread(["Lambda と DynamoDB", "Lambda", "Lambda", "SQS"], SERVICES);

  it("割合の上限を超えるサービスがある_そのサービスを返す(ちょうど上限は超えないとする)", () => {
    expect(spreadWarnings(spread, { maxShare: 0.5 }).overShare.map((r) => r.service)).toEqual(["AWS Lambda"]);
    expect(spreadWarnings(spread, { maxShare: 0.75 }).overShare).toEqual([]);
  });

  it("2 つ以上出る割合が下限に届かない_不足とする。下限を持たなければ見ない", () => {
    expect(spreadWarnings(spread, { maxShare: 1, minMultiServiceShare: 0.3 }).multiShort).toBe(true);
    expect(spreadWarnings(spread, { maxShare: 1, minMultiServiceShare: 0.25 }).multiShort).toBe(false);
    expect(spreadWarnings(spread, { maxShare: 1 }).multiShort).toBe(false);
  });
});
