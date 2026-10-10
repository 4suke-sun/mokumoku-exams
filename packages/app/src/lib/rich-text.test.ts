import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline } from "./rich-text.ts";

describe("parseInline", () => {
  it("強調とコード_種類ごとに分ける", () => {
    expect(parseInline("これは**重要**で、`ls -l` を使う")).toEqual([
      { kind: "text", text: "これは" },
      { kind: "strong", text: "重要" },
      { kind: "text", text: "で、" },
      { kind: "code", text: "ls -l" },
      { kind: "text", text: " を使う" },
    ]);
  });

  it("閉じていない記号_そのまま文字として扱う", () => {
    expect(parseInline("**閉じない と `これも")).toEqual([{ kind: "text", text: "**閉じない と `これも" }]);
  });

  it("HTML のような文字列_タグとして解釈せず文字のまま残す", () => {
    expect(parseInline("<b>x</b>")).toEqual([{ kind: "text", text: "<b>x</b>" }]);
  });
});

describe("parseBlocks", () => {
  it("空行で区切る_段落が分かれ段落内の改行は保たれる", () => {
    const blocks = parseBlocks("1 行目\n2 行目\n\n次の段落");
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toMatchObject({ kind: "paragraph" });
    expect(blocks[0]?.kind === "paragraph" && blocks[0].lines).toHaveLength(2);
  });

  it("ハイフンで始まる連続行_ひとつの箇条書き", () => {
    const blocks = parseBlocks("- 一つ目\n- 二つ目\n\n本文");
    expect(blocks[0]).toEqual({
      kind: "list",
      items: [[{ kind: "text", text: "一つ目" }], [{ kind: "text", text: "二つ目" }]],
    });
    expect(blocks[1]).toMatchObject({ kind: "paragraph" });
  });

  it("見出し行_見出しになる", () => {
    expect(parseBlocks("## 理由\n本文")[0]).toEqual({ kind: "heading", inlines: [{ kind: "text", text: "理由" }] });
  });

  it("フェンスで囲んだ範囲_空行を含めてコードにする", () => {
    const blocks = parseBlocks("前\n```\na = 1\n\nb = **2**\n```\n後");
    expect(blocks.map((b) => b.kind)).toEqual(["paragraph", "code", "paragraph"]);
    expect(blocks[1]).toEqual({ kind: "code", text: "a = 1\n\nb = **2**" });
  });

  it("閉じのないフェンス_末尾までをコードにする", () => {
    expect(parseBlocks("```\nx")).toEqual([{ kind: "code", text: "x" }]);
  });

  it("空の文字列_ブロックなし", () => {
    expect(parseBlocks("")).toEqual([]);
  });
});
