import { describe, expect, it } from "vitest";
import { splitBody } from "./study-body.ts";

const body = "AI を学びます。\n\n本文の段落 1\n\n本文の段落 2\n\n## 押さえどころ\n\n- 要点 A\n- 要点 B";

describe("splitBody", () => {
  it("最初の節_最初の段落が学ぶこと・見出しの前までが本文・見出しのあとがポイント", () => {
    const parts = splitBody(body, true);
    expect(parts.goal).toHaveLength(1);
    expect(parts.main).toHaveLength(2);
    expect(parts.point).toHaveLength(1);
    expect(parts.point[0]).toMatchObject({ kind: "list" });
  });

  it("最初でない節_最初の段落も本文のまま", () => {
    const parts = splitBody(body, false);
    expect(parts.goal).toEqual([]);
    expect(parts.main).toHaveLength(3);
  });

  it("押さえどころの見出しがない_ポイントは空", () => {
    const parts = splitBody("学びます。\n\n本文", true);
    expect(parts.point).toEqual([]);
    expect(parts.main).toHaveLength(1);
  });

  it("別の見出し_ポイントにせず本文に残す", () => {
    const parts = splitBody("学びます。\n\n## 補足\n\n- 項目", true);
    expect(parts.point).toEqual([]);
    expect(parts.main.map((b) => b.kind)).toEqual(["heading", "list"]);
  });

  it("最初のブロックが段落でない_学ぶことは空", () => {
    const parts = splitBody("- 項目だけ\n\n本文", true);
    expect(parts.goal).toEqual([]);
    expect(parts.main).toHaveLength(2);
  });

  it("強調の記法_ブロックの中で解釈される", () => {
    const parts = splitBody("学びます。\n\n==大事==な本文", true);
    const para = parts.main[0];
    expect(para?.kind === "paragraph" && para.lines[0]?.some((i) => i.kind === "mark")).toBe(true);
  });
});
