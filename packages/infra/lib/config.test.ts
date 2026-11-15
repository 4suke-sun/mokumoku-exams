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

  it("同時実行の上限を指定すると_その値を使い_範囲の外や整数でなければ失敗する", () => {
    expect(loadConfig({ ...valid, APP_RESERVED_CONCURRENCY: "10" }).appReservedConcurrency).toBe(10);
    expect(loadConfig(valid).appReservedConcurrency).toBeUndefined();
    for (const bad of ["0", "1001", "2.5", "many"]) {
      expect(() => loadConfig({ ...valid, APP_RESERVED_CONCURRENCY: bad }), bad).toThrow(/APP_RESERVED_CONCURRENCY/);
    }
  });

  it("公開の URL を指定すると_その値を使い_形が違えば失敗する", () => {
    expect(loadConfig({ ...valid, SITE_URL: "https://example.com" }).siteUrl).toBe("https://example.com");
    expect(loadConfig(valid).siteUrl).toBeUndefined();
    for (const bad of ["http://example.com", "https://example.com/", "https://example.com/path"]) {
      expect(() => loadConfig({ ...valid, SITE_URL: bad }), bad).toThrow(/SITE_URL/);
    }
  });

  it("通知の設定を 3 つそろえて指定すると_その値を使い_なければ通知を作らない", () => {
    const vapid = {
      VAPID_PUBLIC_KEY: "P".repeat(87),
      VAPID_PRIVATE_KEY_PARAMETER: "/example/push/vapid-private-key",
      VAPID_SUBJECT: "mailto:admin@example.com",
    };
    expect(loadConfig({ ...valid, ...vapid }).push).toEqual({
      publicKey: vapid.VAPID_PUBLIC_KEY,
      privateKeyParameter: vapid.VAPID_PRIVATE_KEY_PARAMETER,
      subject: vapid.VAPID_SUBJECT,
    });
    expect(loadConfig(valid).push).toBeUndefined();
  });

  it("秘密鍵の値そのものは_設定に取り込まない", () => {
    const vapid = {
      VAPID_PUBLIC_KEY: "P".repeat(87),
      VAPID_PRIVATE_KEY_PARAMETER: "/example/push/vapid-private-key",
      VAPID_SUBJECT: "mailto:admin@example.com",
    };
    const secret = "k".repeat(43);
    // 以前の変数が残っていても、値は設定のどこにも入らない
    expect(JSON.stringify(loadConfig({ ...valid, ...vapid, VAPID_PRIVATE_KEY: secret }))).not.toContain(secret);
    // 秘密鍵の値だけでは、通知の仕組みを作らない(名前がそろわない)
    expect(() =>
      loadConfig({
        ...valid,
        VAPID_PUBLIC_KEY: vapid.VAPID_PUBLIC_KEY,
        VAPID_PRIVATE_KEY: secret,
        VAPID_SUBJECT: vapid.VAPID_SUBJECT,
      }),
    ).toThrow(/3 つそろえて/);
  });

  it("秘密鍵のパラメーターの名前は_/ で始まる階層の名前に限る", () => {
    const base = { VAPID_PUBLIC_KEY: "P".repeat(87), VAPID_SUBJECT: "mailto:admin@example.com" };
    for (const bad of ["vapid-private-key", "/", "/example/*", "/example//key", "/example/key/"]) {
      expect(() => loadConfig({ ...valid, ...base, VAPID_PRIVATE_KEY_PARAMETER: bad }), bad).toThrow(
        /VAPID_PRIVATE_KEY_PARAMETER/,
      );
    }
  });

  it("送信フォームの App の設定を 3 つそろえて指定する_その値を使い_なければ起票の設定を持たない", () => {
    const app = {
      FEEDBACK_GITHUB_APP_ID: "123",
      FEEDBACK_GITHUB_INSTALLATION_ID: "456",
      FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER: "/example/feedback/github-app-private-key",
    };
    expect(loadConfig({ ...valid, ...app }).feedback).toEqual({
      appId: app.FEEDBACK_GITHUB_APP_ID,
      installationId: app.FEEDBACK_GITHUB_INSTALLATION_ID,
      privateKeyParameter: app.FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER,
    });
    expect(loadConfig(valid).feedback).toBeUndefined();
  });

  it("送信フォームの App の設定が一部だけ・形が違う_値を出さずに失敗する", () => {
    expect(() => loadConfig({ ...valid, FEEDBACK_GITHUB_APP_ID: "123" })).toThrow(/3 つそろえて/);
    const marker = "marker-parameter-name";
    const bad = {
      FEEDBACK_GITHUB_APP_ID: "app-x",
      FEEDBACK_GITHUB_INSTALLATION_ID: "install-x",
      FEEDBACK_GITHUB_PRIVATE_KEY_PARAMETER: marker,
    };
    try {
      loadConfig({ ...valid, ...bad });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      for (const name of Object.keys(bad)) expect(message).toContain(name);
      for (const value of Object.values(bad)) expect(message).not.toContain(value);
    }
  });

  it("通知の設定が一部だけ・形が違う_値を出さずに失敗する", () => {
    expect(() => loadConfig({ ...valid, VAPID_PUBLIC_KEY: "P".repeat(87) })).toThrow(/3 つそろえて/);
    const marker = "marker-parameter-name";
    const bad = { VAPID_PUBLIC_KEY: "short", VAPID_PRIVATE_KEY_PARAMETER: marker, VAPID_SUBJECT: "admin@example.com" };
    try {
      loadConfig({ ...valid, ...bad });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      for (const name of Object.keys(bad)) expect(message).toContain(name);
      expect(message).not.toContain(marker);
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

describe("loadConfig の独自ドメイン", () => {
  const domain = {
    DOMAIN_NAME: "app.example.com",
    CERTIFICATE_ARN: "arn:aws:acm:us-east-1:123456789012:certificate/00000000-0000-0000-0000-000000000000",
    HOSTED_ZONE_ID: "Z0000000000EXAMPLE",
  };

  it("指定しない_独自ドメインはない", () => {
    expect(loadConfig(valid).customDomain).toBeUndefined();
  });

  it("ドメイン名と証明書とホストゾーン_その値を使う", () => {
    expect(loadConfig({ ...valid, ...domain }).customDomain).toEqual({
      domainName: domain.DOMAIN_NAME,
      certificateArn: domain.CERTIFICATE_ARN,
      hostedZoneId: domain.HOSTED_ZONE_ID,
    });
  });

  it("ホストゾーンは省略できる", () => {
    const config = loadConfig({ ...valid, ...domain, HOSTED_ZONE_ID: "" });
    expect(config.customDomain?.domainName).toBe(domain.DOMAIN_NAME);
    expect(config.customDomain?.hostedZoneId).toBeUndefined();
  });

  it("ドメイン名だけ_証明書がないと失敗する", () => {
    expect(() => loadConfig({ ...valid, DOMAIN_NAME: domain.DOMAIN_NAME })).toThrow(/CERTIFICATE_ARN/);
  });

  it("ドメイン名がないのに証明書やホストゾーンがある_失敗する", () => {
    expect(() => loadConfig({ ...valid, CERTIFICATE_ARN: domain.CERTIFICATE_ARN })).toThrow(/DOMAIN_NAME/);
    expect(() => loadConfig({ ...valid, HOSTED_ZONE_ID: domain.HOSTED_ZONE_ID })).toThrow(/DOMAIN_NAME/);
  });

  it("形が不正な値_失敗し_値そのものはメッセージに出さない", () => {
    const badDomain = "Not A Domain";
    const otherRegion = domain.CERTIFICATE_ARN.replace("us-east-1", "ap-northeast-1");
    const badZone = "zone-bad";
    try {
      loadConfig({ ...valid, DOMAIN_NAME: badDomain, CERTIFICATE_ARN: otherRegion, HOSTED_ZONE_ID: badZone });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("DOMAIN_NAME");
      expect(message).toContain("CERTIFICATE_ARN");
      expect(message).toContain("HOSTED_ZONE_ID");
      for (const value of [badDomain, otherRegion, badZone]) expect(message).not.toContain(value);
    }
  });
});

describe("loadConfig の予算", () => {
  const budget = { BUDGET_MONTHLY_USD: "10", BUDGET_EMAIL: "billing@example.com" };

  it("指定しない_予算を作らない", () => {
    expect(loadConfig(valid).budget).toBeUndefined();
  });

  it("金額と宛先をそろえて指定する_その値を使う", () => {
    expect(loadConfig({ ...valid, ...budget }).budget).toEqual({ monthlyUsd: 10, email: budget.BUDGET_EMAIL });
    expect(loadConfig({ ...valid, ...budget, BUDGET_MONTHLY_USD: "12.5" }).budget?.monthlyUsd).toBe(12.5);
  });

  it("金額と宛先の片方だけ_失敗する", () => {
    expect(() => loadConfig({ ...valid, BUDGET_MONTHLY_USD: "10" })).toThrow(/そろえて/);
    expect(() => loadConfig({ ...valid, BUDGET_EMAIL: budget.BUDGET_EMAIL })).toThrow(/そろえて/);
  });

  it("形が不正な値_失敗し_値そのものはメッセージに出さない", () => {
    // 金額の不正な値は、どれを渡してもメッセージが同じになる(値をメッセージに埋め込んでいない)
    const amountMessages = ["0", "-5", "1.234", "ten", "1e3"].map((bad) => {
      try {
        loadConfig({ ...valid, ...budget, BUDGET_MONTHLY_USD: bad });
        return expect.unreachable(bad);
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(amountMessages[0]).toContain("BUDGET_MONTHLY_USD");
    expect(new Set(amountMessages).size).toBe(1);
    const badEmail = "not-an-address";
    try {
      loadConfig({ ...valid, ...budget, BUDGET_EMAIL: badEmail });
      expect.unreachable();
    } catch (error) {
      const message = (error as Error).message;
      expect(message).toContain("BUDGET_EMAIL");
      expect(message).not.toContain(badEmail);
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
