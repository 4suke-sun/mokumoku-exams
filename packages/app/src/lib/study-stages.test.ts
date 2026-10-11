import { describe, expect, it } from "vitest";
import { isStagePassed, STAGE_PASS_PERCENT, stageStatuses } from "./study-stages.ts";

const stages = [{ order: 1 }, { order: 2 }, { order: 5 }];

describe("段階学習", () => {
  it("合格の基準_80% ちょうどは合格_それ未満は不合格", () => {
    expect(STAGE_PASS_PERCENT).toBe(80);
    expect(isStagePassed(80)).toBe(true);
    expect(isStagePassed(100)).toBe(true);
    expect(isStagePassed(79.9)).toBe(false);
    expect(isStagePassed(0)).toBe(false);
  });

  it("合格した段階がない_最初の段階だけ挑戦できる", () => {
    expect(stageStatuses(stages, [])).toEqual(["open", "locked", "locked"]);
  });

  it("前の段階に合格_次の段階へ進める(順番が飛んでいても並びの次)", () => {
    expect(stageStatuses(stages, [1])).toEqual(["passed", "open", "locked"]);
    expect(stageStatuses(stages, [1, 2])).toEqual(["passed", "passed", "open"]);
    expect(stageStatuses(stages, [1, 2, 5])).toEqual(["passed", "passed", "passed"]);
  });

  it("いまのデータにない段階の合格の記録_無視する", () => {
    expect(stageStatuses(stages, [3, 99])).toEqual(["open", "locked", "locked"]);
  });

  it("段階がない_空", () => {
    expect(stageStatuses([], [1])).toEqual([]);
  });
});
