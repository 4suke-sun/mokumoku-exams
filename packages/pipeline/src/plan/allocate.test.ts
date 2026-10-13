import { describe, expect, it } from "vitest";
import { allocate } from "./allocate.ts";

describe("allocate", () => {
  it("重みが異なる_比例して配り合計が total になる", () => {
    const result = allocate(255, [0.24, 0.28, 0.24, 0.24]);
    expect(result.reduce((a, b) => a + b, 0)).toBe(255);
    expect(result).toEqual([61, 72, 61, 61]);
  });

  it("端数が同じ_先の項目を優先する", () => {
    expect(allocate(1, [1, 1, 1])).toEqual([1, 0, 0]);
    expect(allocate(2, [1, 1, 1])).toEqual([1, 1, 0]);
  });

  it("重みが 0 の項目_配らない", () => {
    expect(allocate(5, [0, 1, 0, 1])).toEqual([0, 3, 0, 2]);
  });

  it("total が 0 以下か重みの合計が 0_すべて 0 になる", () => {
    expect(allocate(0, [1, 2])).toEqual([0, 0]);
    expect(allocate(-3, [1, 2])).toEqual([0, 0]);
    expect(allocate(5, [0, 0])).toEqual([0, 0]);
  });

  it("重みの合計が 1 でない_比で配る", () => {
    expect(allocate(10, [2, 3])).toEqual([4, 6]);
  });
});
