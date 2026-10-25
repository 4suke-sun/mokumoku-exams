import { describe, expect, it } from "vitest";
import { card } from "../facts/test-helpers.ts";
import { servicePriority, serviceStatus } from "./services.ts";

const SERVICES = ["AWS Lambda", "Amazon DynamoDB", "AWS Step Functions"];
const TARGETS = { minPerService: 1, maxShare: 0.5 };

describe("対象サービスの目標の状況", () => {
  it("出る問題の数と割合_下限に届かないサービスと、割合の上限を超えるサービスを、一覧の順に出す", () => {
    const status = serviceStatus(["Lambda と DynamoDB", "Lambda のみ", "Lambda のみ"], SERVICES, TARGETS);
    expect(status.below).toEqual(["AWS Step Functions"]);
    expect(status.above).toEqual(["AWS Lambda"]);
    expect(status.total).toBe(3);
  });

  it("割合がちょうど上限_超えるとしない", () => {
    expect(serviceStatus(["Lambda", "DynamoDB"], SERVICES, TARGETS).above).toEqual([]);
  });

  it("問題が 0 件_すべてが下限に届かず、上限を超えるサービスはない", () => {
    const status = serviceStatus([], SERVICES, TARGETS);
    expect(status.below).toEqual(SERVICES);
    expect(status.above).toEqual([]);
  });
});

describe("事実カードの選ぶ順の重み", () => {
  const status = { below: ["AWS Step Functions"], above: ["AWS Lambda"] };
  const weight = (claim: string) => servicePriority(card({ claim }), SERVICES, status);

  it("下限に届かないサービスが出る_0(上限を超えるサービスも出るときも 0)", () => {
    expect(weight("Step Functions のステートマシン")).toBe(0);
    expect(weight("Lambda から Step Functions を呼ぶ")).toBe(0);
  });

  it("出るサービスがすべて上限を超える_2", () => {
    expect(weight("Lambda の同時実行数")).toBe(2);
  });

  it("上限を超えないサービスも出る・サービスが出ない_1", () => {
    expect(weight("Lambda から DynamoDB に書く")).toBe(1);
    expect(weight("リージョンごとの上限")).toBe(1);
  });
});
