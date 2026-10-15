import { describe, expect, it } from "vitest";
import { checkPlan, inScope, type Plan } from "./plan.ts";

const CODE = "AWS-AIB-C01";

export function plan(overrides: Partial<Plan> = {}): Plan {
  return {
    examCode: CODE,
    sources: [{ url: "https://docs.aws.amazon.com/guide/index.html", kind: "exam-guide" }],
    scope: { prefixes: ["https://docs.aws.amazon.com/guide/"], maxDepth: 1 },
    exclude: ["https://docs.aws.amazon.com/guide/private/"],
    ...overrides,
  };
}

const reasons = (raw: unknown) => checkPlan(raw, CODE).problems.map((p) => p.reason);

describe("収集の計画の検査", () => {
  it("正しい計画_通す", () => {
    expect(checkPlan(plan(), CODE)).toEqual({ plan: plan(), problems: [] });
  });

  it("スキーマに合わない(深さの上限超え・未知の項目・欠けた項目)_落とす", () => {
    expect(reasons(plan({ scope: { prefixes: ["https://docs.aws.amazon.com/"], maxDepth: 4 } }))).toContain("schema");
    expect(reasons({ ...plan(), extra: 1 })).toContain("schema");
    expect(reasons({ examCode: CODE })).toContain("schema");
  });

  it("許可ドメイン以外・https 以外_落とす", () => {
    expect(
      reasons(plan({ sources: [{ url: "https://unlisted.example.com/guide/", kind: "official-doc" }] })),
    ).toContain("host-not-allowed");
    expect(reasons(plan({ scope: { prefixes: ["http://docs.aws.amazon.com/guide/"], maxDepth: 0 } }))).toContain(
      "not-https",
    );
  });

  it("範囲の外の URL、除外と一覧の矛盾、重複、資格コードの違い_落とす", () => {
    expect(
      reasons(plan({ sources: [{ url: "https://docs.aws.amazon.com/other/a", kind: "official-doc" }] })),
    ).toContain("out-of-scope");
    expect(
      reasons(plan({ sources: [{ url: "https://docs.aws.amazon.com/guide/private/a", kind: "official-doc" }] })),
    ).toContain("excluded-listed");
    const dup = { url: "https://docs.aws.amazon.com/guide/a", kind: "official-doc" as const };
    expect(reasons(plan({ sources: [dup, dup] }))).toContain("duplicate");
    expect(checkPlan(plan(), "EX-SMP-XX").problems.map((p) => p.reason)).toContain("exam-code-mismatch");
  });

  it("試験ガイドが 2 つ以上_落とす", () => {
    const g = (n: number) => ({ url: `https://docs.aws.amazon.com/guide/${n}`, kind: "exam-guide" as const });
    expect(reasons(plan({ sources: [g(1), g(2)] }))).toContain("multiple-exam-guides");
  });

  it("試験ガイドの続きのページ_範囲の中なら通し、試験ガイドがない・範囲の外・除外・重複は落とす", () => {
    const page = "https://docs.aws.amazon.com/guide/domain1.html";
    expect(checkPlan(plan({ guidePages: [page] }), CODE).problems).toEqual([]);
    const docOnly = { url: "https://docs.aws.amazon.com/guide/a", kind: "official-doc" as const };
    expect(reasons(plan({ sources: [docOnly], guidePages: [page] }))).toContain("no-exam-guide");
    expect(reasons(plan({ guidePages: ["https://docs.aws.amazon.com/other/a"] }))).toContain("out-of-scope");
    expect(reasons(plan({ guidePages: ["https://docs.aws.amazon.com/guide/private/a"] }))).toContain("excluded-listed");
    expect(reasons(plan({ guidePages: [page, page] }))).toContain("duplicate");
    expect(reasons(plan({ guidePages: ["https://docs.aws.amazon.com/guide/index.html"] }))).toContain("duplicate");
    // 試験ガイド以外の収集を始める URL とも重ねない(種別を一意に決めるため)
    const guide = plan().sources[0] as { url: string; kind: "exam-guide" };
    expect(reasons(plan({ sources: [guide, { url: page, kind: "official-doc" }], guidePages: [page] }))).toContain(
      "duplicate",
    );
  });

  it("範囲の判定_接頭辞の中で、除外に当たらず、出典に使える URL だけ", () => {
    const p = plan();
    expect(inScope(p, "https://docs.aws.amazon.com/guide/a.html")).toBe(true);
    expect(inScope(p, "https://docs.aws.amazon.com/other/a.html")).toBe(false);
    expect(inScope(p, "https://docs.aws.amazon.com/guide/private/a.html")).toBe(false);
  });
});
