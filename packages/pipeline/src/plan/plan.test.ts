import { describe, expect, it } from "vitest";
import { buildPlan, type ExistingQuestion, planItemId, resolveSettings } from "./plan.ts";
import { parsePlan } from "./schema.ts";

const settings = {
  targetTotal: 20,
  difficultyMix: { easy: 0.3, medium: 0.5, hard: 0.2 },
  typeMix: { single: 0.75, multiple: 0.2, "free-text": 0.05 },
};
const domains = [
  { code: "domain1", weight: 0.6 },
  { code: "domain2", weight: 0.4 },
];

function existing(domain: string, count: number, overrides: Partial<ExistingQuestion> = {}): ExistingQuestion[] {
  return Array.from({ length: count }, () => ({ domain, difficulty: "medium", kind: "single", ...overrides }));
}

describe("buildPlan", () => {
  it("既存の問題がないとき_分野の目標の合計が目標の問題数になり_不足は目標と同じになる", () => {
    const plan = buildPlan({ examCode: "EX-SMP-XX", domains, existing: [], settings });
    expect(plan.targetTotal).toBe(20);
    expect(plan.domains).toEqual([
      { domain: "domain1", target: 12, existing: 0, missing: 12 },
      { domain: "domain2", target: 8, existing: 0, missing: 8 },
    ]);
    expect(plan.items.reduce((a, i) => a + i.count, 0)).toBe(20);
    expect(() => parsePlan(plan)).not.toThrow();
  });

  it("既存の問題が目標を満たす分野_不足が 0 で_その分野の項目が出ない", () => {
    const plan = buildPlan({
      examCode: "EX-SMP-XX",
      domains,
      existing: existing("domain1", 12),
      settings,
    });
    expect(plan.domains[0]).toEqual({ domain: "domain1", target: 12, existing: 12, missing: 0 });
    expect(plan.items.filter((i) => i.domain === "domain1")).toEqual([]);
    expect(plan.items.reduce((a, i) => a + i.count, 0)).toBe(8);
  });

  it("既存の問題が目標を超える分野_不足は 0 で負にならない", () => {
    const plan = buildPlan({ examCode: "EX-SMP-XX", domains, existing: existing("domain1", 30), settings });
    expect(plan.domains[0]?.missing).toBe(0);
  });

  it("既存の問題の分布に偏りがあるとき_足りない区分を優先して補う", () => {
    const plan = buildPlan({
      examCode: "EX-SMP-XX",
      domains: [{ code: "domain1", weight: 1 }],
      existing: existing("domain1", 10, { difficulty: "medium", kind: "single" }),
      settings,
    });
    const missing = plan.domains[0]?.missing ?? 0;
    expect(missing).toBe(10);
    // medium の単一は目標を満たしているので、補うのは主に easy と hard
    const mediumSingle = plan.items.find((i) => i.difficulty === "medium" && i.kind === "single");
    const easySingle = plan.items.find((i) => i.difficulty === "easy" && i.kind === "single");
    expect((mediumSingle?.count ?? 0) <= (easySingle?.count ?? 0)).toBe(true);
    expect(plan.items.reduce((a, i) => a + i.count, 0)).toBe(10);
  });

  it("難易度のない既存の問題_medium として数える", () => {
    const withLevel = buildPlan({
      examCode: "EX-SMP-XX",
      domains: [{ code: "domain1", weight: 1 }],
      existing: existing("domain1", 4, { difficulty: "medium" }),
      settings,
    });
    const without = buildPlan({
      examCode: "EX-SMP-XX",
      domains: [{ code: "domain1", weight: 1 }],
      existing: existing("domain1", 4, { difficulty: undefined }),
      settings,
    });
    expect(without).toEqual(withLevel);
  });

  it("マスタにない分野の既存の問題_数えない", () => {
    const plan = buildPlan({ examCode: "EX-SMP-XX", domains, existing: existing("domain9", 5), settings });
    expect(plan.existingTotal).toBe(0);
  });

  it("同じ入力_同じ計画になり_項目の ID が安定する", () => {
    const a = buildPlan({ examCode: "EX-SMP-XX", domains, existing: existing("domain2", 3), settings });
    const b = buildPlan({ examCode: "EX-SMP-XX", domains, existing: existing("domain2", 3), settings });
    expect(a).toEqual(b);
    expect(a.items[0]?.id).toBe(
      planItemId("EX-SMP-XX", a.items[0]?.domain ?? "", a.items[0]?.difficulty ?? "easy", a.items[0]?.kind ?? "single"),
    );
  });
});

describe("resolveSettings", () => {
  const plan = {
    targetMultiplier: 3,
    difficultyMix: { easy: 0.3, medium: 0.5, hard: 0.2 },
    typeMix: { single: 0.75, multiple: 0.2, "free-text": 0.05 },
    overrides: {
      "EX-SMP-XX": { targetTotal: 40, difficultyMix: { easy: 0.5, medium: 0.5, hard: 0 } },
    },
  };

  it("上書きがないとき_本番の出題数に倍率をかけた数が目標になる", () => {
    expect(resolveSettings(plan, "AWS-AIB-C01", 85).targetTotal).toBe(255);
  });

  it("上書きがあるとき_その項目だけ上書きされる", () => {
    const s = resolveSettings(plan, "EX-SMP-XX", 5);
    expect(s.targetTotal).toBe(40);
    expect(s.difficultyMix.hard).toBe(0);
    expect(s.typeMix.single).toBe(0.75);
  });
});
