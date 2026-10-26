import { describe, expect, it } from "vitest";
import { buildTestStages, formatSummary, runAllStages } from "./test-all-plan.ts";

describe("buildTestStages", () => {
  it("すべてのテストの段階_scriptsとdata-schemaとすべてのワークスペースを含み、lintとbuildを含まない", () => {
    const names = buildTestStages().map((s) => s.name);
    expect(names).toEqual(["test(scripts)", "test(data-schema)", "test(app)", "test(infra)", "test(pipeline)"]);
  });
});

describe("runAllStages", () => {
  const stages = buildTestStages();

  it("途中の段階が失敗_後ろの段階も流し、すべての結果を返す", () => {
    const ran: string[] = [];
    const results = runAllStages(
      stages,
      (stage) => {
        ran.push(stage.name);
        return stage.name !== "test(data-schema)";
      },
      () => 0,
    );
    expect(ran).toEqual(stages.map((s) => s.name));
    expect(results.map((r) => [r.name, r.ok])).toEqual([
      ["test(scripts)", true],
      ["test(data-schema)", false],
      ["test(app)", true],
      ["test(infra)", true],
      ["test(pipeline)", true],
    ]);
  });

  it("段階ごとの時間_開始と終了の差を持つ", () => {
    let t = 0;
    const results = runAllStages(
      stages.slice(0, 2),
      () => true,
      () => (t += 1500),
    );
    expect(results.map((r) => r.ms)).toEqual([1500, 1500]);
  });
});

describe("formatSummary", () => {
  it("失敗が複数_失敗した段階をすべて挙げる", () => {
    const text = formatSummary([
      { name: "test(scripts)", ms: 1000, ok: false },
      { name: "test(app)", ms: 2000, ok: true },
      { name: "test(pipeline)", ms: 3000, ok: false },
    ]);
    expect(text).toContain("失敗した段階: test(scripts), test(pipeline)");
    expect(text).toContain("成功     2.0 秒  test(app)");
  });

  it("すべて成功_すべて成功と出す", () => {
    expect(formatSummary([{ name: "test(app)", ms: 100, ok: true }])).toContain("すべて成功");
  });
});
