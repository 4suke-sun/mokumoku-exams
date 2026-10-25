import { describe, expect, it } from "vitest";
import { countServices, mentionedServices, serviceAliases } from "./services.ts";

const SERVICES = [
  "Amazon Simple Queue Service (Amazon SQS)",
  "AWS Lambda",
  "Amazon CloudWatch",
  "Amazon CloudWatch Logs",
  "AWS Serverless Application Model (AWS SAM)",
];

describe("サービスの呼び方", () => {
  it("括弧つきの略称がある正式名_括弧の外と中の、接頭辞のある形とない形を返す", () => {
    expect(serviceAliases("Amazon Simple Queue Service (Amazon SQS)")).toEqual([
      "Amazon Simple Queue Service",
      "Simple Queue Service",
      "Amazon SQS",
      "SQS",
    ]);
  });

  it("括弧のない正式名_接頭辞のある形とない形を返す", () => {
    expect(serviceAliases("AWS Lambda")).toEqual(["AWS Lambda", "Lambda"]);
  });

  it("接頭辞のない名前_その名前だけを返す", () => {
    expect(serviceAliases("Elastic Load Balancing")).toEqual(["Elastic Load Balancing"]);
  });
});

describe("本文に出るサービス", () => {
  it("略称と接頭辞のない形_正式名で返す", () => {
    expect(mentionedServices("Lambda 関数から SQS のキューへ送る。", SERVICES)).toEqual(
      new Set(["AWS Lambda", "Amazon Simple Queue Service (Amazon SQS)"]),
    );
  });

  it("長い名前の中に短い名前がある_長い名前だけを数える", () => {
    expect(mentionedServices("CloudWatch Logs に出力する。", SERVICES)).toEqual(new Set(["Amazon CloudWatch Logs"]));
  });

  it("長い名前と、別の場所の短い名前がある_両方を数える", () => {
    expect(mentionedServices("CloudWatch Logs と CloudWatch のアラーム。", SERVICES)).toEqual(
      new Set(["Amazon CloudWatch Logs", "Amazon CloudWatch"]),
    );
  });

  it("英数字の語の一部に名前がある_数えない", () => {
    expect(mentionedServices("SQSQueue と LambdaX と SAMPLE", SERVICES)).toEqual(new Set());
  });

  it("大文字小文字が違う_数えない", () => {
    expect(mentionedServices("lambda と sqs", SERVICES)).toEqual(new Set());
  });

  it("同じサービスが何度も出る_1 回だけ返す", () => {
    expect(mentionedServices("SAM で作り、AWS SAM で配る。", SERVICES)).toEqual(
      new Set(["AWS Serverless Application Model (AWS SAM)"]),
    );
  });
});

describe("サービスの数え上げ", () => {
  it("本文の並び_本文ごとに 1 回ずつ数え、出ないサービスは 0 にする", () => {
    const counts = countServices(["Lambda と Lambda", "Lambda と SQS"], SERVICES);
    expect(counts.get("AWS Lambda")).toBe(2);
    expect(counts.get("Amazon Simple Queue Service (Amazon SQS)")).toBe(1);
    expect(counts.get("Amazon CloudWatch")).toBe(0);
  });
});
