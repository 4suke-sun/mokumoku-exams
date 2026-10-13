import { describe, expect, it } from "vitest";
import {
  type CheckInput,
  checkDeprecation,
  checkFreshness,
  checkLiveness,
  checkOfficial,
  checkTarget,
  runChecks,
  statusFromChecks,
} from "./checks.ts";
import type { FetchResult } from "./fetcher.ts";
import { fixture } from "./test-helpers.ts";

const URL_OK = "https://docs.aws.amazon.com/guide/a.html";

function ok(body = "<p>synthetic</p>", finalUrl = URL_OK): FetchResult {
  return {
    ok: true,
    finalUrl,
    body: Buffer.from(body),
    hash: "a".repeat(64),
    contentType: "text/html",
    lastModified: null,
  };
}

function input(overrides: Partial<CheckInput> = {}): CheckInput {
  return {
    entry: { url: URL_OK, target: { examCode: "AWS-AIB-C01", edition: "C01" } },
    exam: { examCode: "AWS-AIB-C01", vendor: "AWS", edition: "C01" },
    fetched: ok(),
    updatedAt: "2026-06-01",
    today: "2026-10-13",
    freshnessDays: 365,
    ...overrides,
  };
}

describe("公式か", () => {
  it("許可ドメインで、ベンダーが対応する_合格", () => {
    expect(checkOfficial(input())).toEqual({ name: "official", result: "pass" });
    // 公的な機関のホストも、対応表で許したベンダーなら合格
    expect(
      checkOfficial(
        input({
          entry: { url: "https://www.nist.gov/x", target: { examCode: "AWS-AIB-C01" } },
          fetched: ok("", "https://www.nist.gov/x"),
        }),
      ).result,
    ).toBe("pass");
  });
  it("ベンダーが違う・リダイレクト先が許可外_不合格", () => {
    expect(checkOfficial(input({ exam: { examCode: "EX-SMP-XX", vendor: "Example" } }))).toEqual({
      name: "official",
      result: "fail",
      reason: "vendor-mismatch",
    });
    expect(checkOfficial(input({ fetched: ok("", "https://unlisted.example.com/") })).reason).toBe("host-not-allowed");
  });
  it("資格マスタにない_確認不能", () => {
    expect(checkOfficial(input({ exam: null })).result).toBe("unknown");
  });
});

describe("対象の資格・版・リージョン", () => {
  it("一致_合格", () => {
    expect(checkTarget(input()).result).toBe("pass");
  });
  it("資格・版・リージョンが違う_不合格", () => {
    expect(checkTarget(input({ exam: { examCode: "AWS-XXX-C01", vendor: "AWS", edition: "C01" } })).reason).toBe(
      "exam-mismatch",
    );
    expect(checkTarget(input({ exam: { examCode: "AWS-AIB-C01", vendor: "AWS", edition: "C02" } })).reason).toBe(
      "edition-mismatch",
    );
    const regional = input({
      entry: { url: URL_OK, target: { examCode: "AWS-AIB-C01", region: "eu-west-1" } },
      regions: ["us-east-1"],
    });
    expect(checkTarget(regional).reason).toBe("region-mismatch");
  });
  it("マスタに版がない_確認不能", () => {
    expect(checkTarget(input({ exam: { examCode: "AWS-AIB-C01", vendor: "AWS" } }))).toEqual({
      name: "target",
      result: "unknown",
      reason: "edition-unknown",
    });
  });
});

describe("廃止・更新の兆候", () => {
  it("ページの中の機能の非推奨の記述_反応しない", () => {
    expect(checkDeprecation(input({ fetched: ok(fixture("doc.html")) })).result).toBe("pass");
  });
  it("ページ自体の廃止の記述・410_不合格", () => {
    expect(checkDeprecation(input({ fetched: ok(fixture("deprecated.html")) })).reason).toBe("deprecation-signal");
    expect(checkDeprecation(input({ fetched: { ok: false, reason: "http-error", status: 410 } })).reason).toBe("gone");
  });
  it("本文がない_確認不能", () => {
    expect(checkDeprecation(input({ fetched: { ok: false, reason: "timeout" } })).result).toBe("unknown");
  });
});

describe("日付が新しいか", () => {
  it("期間の内_合格。更新日がない_取得日で代えて合格", () => {
    expect(checkFreshness(input()).result).toBe("pass");
    expect(checkFreshness(input({ updatedAt: null })).result).toBe("pass");
  });
  it("期間を過ぎた_不合格", () => {
    expect(checkFreshness(input({ updatedAt: "2020-01-15" }))).toEqual({
      name: "freshness",
      result: "fail",
      reason: "stale",
    });
  });
  it("未来の日付・本文がない_確認不能", () => {
    expect(checkFreshness(input({ updatedAt: "2027-01-01" })).reason).toBe("future-date");
    expect(checkFreshness(input({ fetched: { ok: false, reason: "timeout" } })).reason).toBe("no-body");
  });
});

describe("リンクが生きているか", () => {
  it("取得できた_合格", () => {
    expect(checkLiveness(input()).result).toBe("pass");
  });
  it("404・410・許可外へのリダイレクト_不合格", () => {
    expect(checkLiveness(input({ fetched: { ok: false, reason: "http-error", status: 404 } })).reason).toBe(
      "dead-link",
    );
    expect(checkLiveness(input({ fetched: { ok: false, reason: "not-allowed" } })).reason).toBe("redirect-not-allowed");
  });
  it("タイムアウト・5xx・robots_確認不能", () => {
    expect(checkLiveness(input({ fetched: { ok: false, reason: "timeout" } })).reason).toBe("timeout");
    expect(checkLiveness(input({ fetched: { ok: false, reason: "http-error", status: 503 } })).result).toBe("unknown");
    expect(checkLiveness(input({ fetched: { ok: false, reason: "robots-disallowed" } })).result).toBe("unknown");
  });
});

describe("台帳の状態への反映", () => {
  it("すべて合格_active", () => {
    expect(statusFromChecks(runChecks(input()))).toBe("active");
  });
  it("確認不能が 1 つでもある_active にしない(先へ進めない)", () => {
    expect(statusFromChecks(runChecks(input({ exam: { examCode: "AWS-AIB-C01", vendor: "AWS" } })))).toBe(
      "needs-review",
    );
  });
  it("廃止の兆候_deprecated、リンクを確かめられない_unreachable", () => {
    expect(statusFromChecks(runChecks(input({ fetched: ok(fixture("deprecated.html")) })))).toBe("deprecated");
    expect(statusFromChecks(runChecks(input({ fetched: { ok: false, reason: "timeout" } })))).toBe("unreachable");
  });
  it("結果_検査名・結果・理由コードだけで、本文を含まない", () => {
    const outcomes = runChecks(input({ fetched: ok(fixture("deprecated.html")) }));
    for (const o of outcomes) expect(Object.keys(o).every((k) => ["name", "result", "reason"].includes(k))).toBe(true);
    expect(JSON.stringify(outcomes)).not.toContain("archived");
  });
});
