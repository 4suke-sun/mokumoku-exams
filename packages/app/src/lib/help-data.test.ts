import { describe, expect, it } from "vitest";
import { listHelpSections } from "./help-data.ts";

describe("listHelpSections", () => {
  it("使い方のデータ_セクションが 1 つ以上あり_ID が重複しない", () => {
    const sections = listHelpSections();
    expect(sections.length).toBeGreaterThan(0);
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
