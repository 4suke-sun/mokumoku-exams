import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PlanError, type PlanFile, parsePlan, planPath, readPlan, serializePlan, writePlan } from "./schema.ts";

const valid: PlanFile = {
  examCode: "EX-SMP-XX",
  targetTotal: 10,
  existingTotal: 4,
  domains: [{ domain: "domain1", target: 10, existing: 4, missing: 6 }],
  items: [{ id: "p-aaaaaaaaaaaa", domain: "domain1", difficulty: "easy", kind: "single", count: 6 }],
};

function errorPaths(plan: unknown): string[] {
  try {
    parsePlan(plan);
  } catch (error) {
    if (error instanceof PlanError) return error.paths;
  }
  return [];
}

describe("出題計画のスキーマ", () => {
  it("正しい計画_通る", () => {
    expect(parsePlan(valid)).toEqual(valid);
  });

  it("分野の目標の合計が目標の問題数と違う_落ちる", () => {
    expect(errorPaths({ ...valid, targetTotal: 11 })).toContain("targetTotal");
  });

  it("項目の数の合計が不足と違う_落ちる", () => {
    const items = [{ ...(valid.items[0] as PlanFile["items"][number]), count: 5 }];
    expect(errorPaths({ ...valid, items })).toContain("items");
  });

  it("不足が目標と既存の差と違う_落ちる", () => {
    const domains = [{ domain: "domain1", target: 10, existing: 4, missing: 5 }];
    expect(errorPaths({ ...valid, domains })).toContain("domains.0.missing");
  });

  it("未知の項目がある_落ちる", () => {
    expect(errorPaths({ ...valid, extra: 1 })).not.toEqual([]);
  });

  it("項目の ID が重複している_落ちる", () => {
    const item = valid.items[0] as PlanFile["items"][number];
    const plan = {
      ...valid,
      domains: [{ domain: "domain1", target: 10, existing: 0, missing: 10 }],
      existingTotal: 0,
      items: [item, { ...item, difficulty: "hard" }],
    };
    expect(errorPaths(plan)).toContain("items");
  });

  it("書き出し_検査してから書き_読み戻すと同じ", () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-plan-"));
    const path = planPath(dir, "EX-SMP-XX");
    writePlan(path, valid);
    expect(readFileSync(path, "utf8")).toBe(serializePlan(valid));
    expect(readPlan(path)).toEqual(valid);
  });

  it("不正な計画を書こうとする_書かずに失敗する", () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-plan-"));
    const path = planPath(dir, "EX-SMP-XX");
    expect(() => writePlan(path, { ...valid, targetTotal: 99 })).toThrow(PlanError);
    expect(readPlan(path)).toBeNull();
  });

  it("壊れたファイルを読む_JSON の形の誤りとして失敗する", async () => {
    const { writeFileSync, mkdirSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "pipeline-plan-"));
    const path = planPath(dir, "EX-SMP-XX");
    mkdirSync(join(dir, "plan", "ex-smp-xx"), { recursive: true });
    writeFileSync(path, "{ broken");
    expect(() => readPlan(path)).toThrow(PlanError);
  });
});
