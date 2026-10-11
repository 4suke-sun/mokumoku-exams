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

  it("通知先のメールを指定すると_その値を使う", () => {
    expect(loadConfig({ ...valid, ALARM_EMAIL: "alerts@example.com" }).alarmEmail).toBe("alerts@example.com");
    expect(loadConfig(valid).alarmEmail).toBeUndefined();
  });

  it("通知先のメールの形が不正だと_値を出さずに失敗する", () => {
    const bad = "not-an-address";
    expect(() => loadConfig({ ...valid, ALARM_EMAIL: bad })).toThrow(/ALARM_EMAIL/);
    expect(() => loadConfig({ ...valid, ALARM_EMAIL: bad })).not.toThrow(new RegExp(bad));
  });

  it("公開の URL を指定すると_その値を使い_形が違えば失敗する", () => {
    expect(loadConfig({ ...valid, SITE_URL: "https://example.com" }).siteUrl).toBe("https://example.com");
    expect(loadConfig(valid).siteUrl).toBeUndefined();
    for (const bad of ["http://example.com", "https://example.com/", "https://example.com/path"]) {
      expect(() => loadConfig({ ...valid, SITE_URL: bad }), bad).toThrow(/SITE_URL/);
    }
  });

  it("通知の鍵を 3 つそろえて指定すると_その値を使い_なければ通知を作らない", () => {
    const vapid = {
      VAPID_PUBLIC_KEY: "P".repeat(87),
      VAPID_PRIVATE_KEY: "k".repeat(43),
      VAPID_SUBJECT: "mailto:admin@example.com",
    };
    expect(loadConfig({ ...valid, ...vapid }).push).toEqual({
      publicKey: vapid.VAPID_PUBLIC_KEY,
      privateKey: vapid.VAPID_PRIVATE_KEY,
      subject: vapid.VAPID_SUBJECT,
    });
    expect(loadConfig(valid).push).toBeUndefined();
  });

  it("通知の鍵が一部だけ・形が違う_値を出さずに失敗する", () => {
    expect(() => loadConfig({ ...valid, VAPID_PUBLIC_KEY: "P".repeat(87) })).toThrow(/3 つそろえて/);
    const secret = "s".repeat(42);
    const bad = { VAPID_PUBLIC_KEY: "short", VAPID_PRIVATE_KEY: secret, VAPID_SUBJECT: "admin@example.com" };
    try {
      loadConfig({ ...valid, ...bad });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      for (const name of Object.keys(bad)) expect(message).toContain(name);
      expect(message).not.toContain(secret);
      expect(message).not.toContain("short");
    }
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
