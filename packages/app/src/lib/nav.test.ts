import { describe, expect, it } from "vitest";
import { isActive } from "./nav.ts";

describe("isActive", () => {
  it("ホームで/_ホームが現在地", () => {
    expect(isActive("/", "/")).toBe(true);
  });

  it("資格の配下_ホームは現在地でない", () => {
    expect(isActive("/exams/saa", "/")).toBe(false);
  });

  it("資格の配下_資格が現在地", () => {
    expect(isActive("/exams/saa/play", "/exams")).toBe(true);
  });

  it("前方一致するだけの別パス_現在地でない", () => {
    expect(isActive("/examsx", "/exams")).toBe(false);
  });
});
