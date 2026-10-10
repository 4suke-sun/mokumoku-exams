import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENV_VARIABLES, loadConfig } from "./config.ts";

const valid = {
  WEB_ADAPTER_LAYER_ARN: "arn:aws:lambda:us-east-1:123456789012:layer:LambdaAdapterLayerX86:25",
  ORIGIN_VERIFY_VALUE: "x".repeat(32),
};

describe("loadConfig", () => {
  it("必須の値がそろっていて_接頭辞は既定になる", () => {
    expect(loadConfig(valid)).toEqual({
      stackPrefix: "mokumoku-exams",
      webAdapterLayerArn: valid.WEB_ADAPTER_LAYER_ARN,
      originVerifyValue: valid.ORIGIN_VERIFY_VALUE,
    });
  });

  it("接頭辞を指定すると_その値を使う", () => {
    expect(loadConfig({ ...valid, STACK_PREFIX: "dev-a" }).stackPrefix).toBe("dev-a");
  });

  it("必須の変数がないと_変数の名前を示して失敗する", () => {
    expect(() => loadConfig({})).toThrow(/WEB_ADAPTER_LAYER_ARN.*\n.*ORIGIN_VERIFY_VALUE/);
  });

  it("形が不正な値は_失敗し_値そのものはメッセージに出さない", () => {
    const tooShort = "short-value";
    try {
      loadConfig({ WEB_ADAPTER_LAYER_ARN: "not-an-arn", ORIGIN_VERIFY_VALUE: tooShort, STACK_PREFIX: "1bad" });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("WEB_ADAPTER_LAYER_ARN");
      expect(message).toContain("ORIGIN_VERIFY_VALUE");
      expect(message).toContain("STACK_PREFIX");
      expect(message).not.toContain(tooShort);
      expect(message).not.toContain("not-an-arn");
    }
  });
});

describe(".env.example", () => {
  it("設定の変数の一覧と_一致している", () => {
    const text = readFileSync(new URL("../../../.env.example", import.meta.url), "utf8");
    const names = text
      .split("\n")
      .map((line) => /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line)?.[1])
      .filter((name): name is string => name !== undefined);
    expect([...names].sort()).toEqual([...ENV_VARIABLES].sort());
  });
});
