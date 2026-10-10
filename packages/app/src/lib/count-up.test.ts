import { describe, expect, it } from "vitest";
import { countUpValue, easeOut } from "./count-up.ts";

describe("easeOut", () => {
  it("0 から 1 へ_減速しながら進む", () => {
    expect(easeOut(0)).toBe(0);
    expect(easeOut(1)).toBe(1);
    expect(easeOut(0.5)).toBeGreaterThan(0.5);
  });
});

describe("countUpValue", () => {
  it("始まる前_0 を返す", () => {
    expect(countUpValue(72, 0, 1000)).toBe(0);
    expect(countUpValue(72, -10, 1000)).toBe(0);
  });

  it("終わったあと_目標の値ちょうどを返し止まる", () => {
    expect(countUpValue(66.7, 1000, 1000)).toBe(66.7);
    expect(countUpValue(66.7, 5000, 1000)).toBe(66.7);
  });

  it("途中_0 と目標の間で_時間とともに増える", () => {
    const early = countUpValue(80, 200, 1000);
    const late = countUpValue(80, 800, 1000);
    expect(early).toBeGreaterThan(0);
    expect(late).toBeGreaterThan(early);
    expect(late).toBeLessThan(80);
  });

  it("時間が 0 以下_すぐに目標の値を返す", () => {
    expect(countUpValue(50, 0, 0)).toBe(50);
  });
});
