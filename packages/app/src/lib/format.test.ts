import { describe, expect, it } from "vitest";
import { formatAnswerTime, formatDate } from "./format.ts";

describe("formatAnswerTime", () => {
  it("1 分未満_秒で示す", () => {
    expect(formatAnswerTime(0)).toBe("0 秒");
    expect(formatAnswerTime(59_400)).toBe("59 秒");
  });

  it("1 分以上_分と秒で示す", () => {
    expect(formatAnswerTime(60_000)).toBe("1 分 0 秒");
    expect(formatAnswerTime(125_000)).toBe("2 分 5 秒");
  });
});

describe("formatDate", () => {
  it("読み取れない値_空にする", () => {
    expect(formatDate("not-a-date")).toBe("");
  });
});
