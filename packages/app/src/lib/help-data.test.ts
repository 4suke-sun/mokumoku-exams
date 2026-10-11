import { describe, expect, it } from "vitest";
import { helpUpdatedAt, listHelpSections } from "./help-data.ts";

describe("listHelpSections", () => {
  it("使い方のデータ_セクションが 1 つ以上あり_ID が重複しない", () => {
    const sections = listHelpSections();
    expect(sections.length).toBeGreaterThan(0);
    const ids = sections.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("節と項目の ID_ページの中で重複しない(目次のリンクになる)", () => {
    const ids = listHelpSections().flatMap((s) => [s.id, ...(s.items ?? []).map((item) => item.id)]);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("最終更新日_書いてあれば YYYY-MM-DD", () => {
    const date = helpUpdatedAt();
    if (date !== null) expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
