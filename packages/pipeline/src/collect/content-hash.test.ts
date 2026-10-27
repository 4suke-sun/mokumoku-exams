import { describe, expect, it } from "vitest";
import { contentHashOf, isHtml, rawSha256, visibleText } from "./content-hash.ts";

function page(parts: { head?: string; banner?: string; main: string; footer?: string }): Buffer {
  return Buffer.from(
    `<!DOCTYPE html><html><head>${parts.head ?? ""}<title>題</title></head><body>` +
      `<nav>${parts.banner ?? ""}</nav><main><h1>見出し</h1>${parts.main}</main><footer>${parts.footer ?? ""}</footer></body></html>`,
  );
}

describe("出典の本文のハッシュ", () => {
  it("head のメタとスクリプトだけが違うHTML_同じハッシュ", () => {
    const a = page({
      head: '<meta property="og:updated_time" content="2026-10-08"><script>var a=1</script>',
      main: "<p>本文です</p>",
    });
    const b = page({
      head: '<meta property="og:updated_time" content="2026-10-26"><script>var a=2</script>',
      main: "<p>本文です</p>",
    });
    expect(contentHashOf(a)).toBe(contentHashOf(b));
  });

  it("main の外のお知らせのバナーだけが違うHTML_同じハッシュ", () => {
    const a = page({ banner: "<div>イベントの案内 A</div>", main: "<p>本文です</p>" });
    const b = page({ banner: "<div>イベントの案内 B</div>", footer: "更新", main: "<p>本文です</p>" });
    expect(contentHashOf(a)).toBe(contentHashOf(b));
  });

  it("main の中の本文が違うHTML_違うハッシュ", () => {
    const a = page({ main: "<p>上限は 10 です</p>" });
    const b = page({ main: "<p>上限は 20 です</p>" });
    expect(contentHashOf(a)).not.toBe(contentHashOf(b));
  });

  it("タグの付け方と空白と文字参照だけが違う本文_同じハッシュ", () => {
    const a = page({ main: "<p>A &amp; B</p>\n<p>説明</p>" });
    const b = page({ main: '<p class="x">A  &amp;  B</p><p>説明</p>' });
    expect(contentHashOf(a)).toBe(contentHashOf(b));
  });

  it("main がないHTML_head の違いは無視し、body の本文の違いは検出する", () => {
    const html = (head: string, body: string) =>
      Buffer.from(`<html><head>${head}</head><body><p>${body}</p></body></html>`);
    expect(contentHashOf(html("<meta name=a content=1>", "本文"))).toBe(
      contentHashOf(html("<meta name=a content=2>", "本文")),
    );
    expect(contentHashOf(html("", "本文"))).not.toBe(contentHashOf(html("", "本文が変わった")));
  });

  it("コメントと非表示のブロックだけが違う本文_同じハッシュ", () => {
    const a = page({
      main: "<p>本文</p><!-- 版 1 --><template>テンプレート 1</template><noscript>JS 無し 1</noscript>",
    });
    const b = page({
      main: "<p>本文</p><!-- 版 2 --><template>テンプレート 2</template><noscript>JS 無し 2</noscript>",
    });
    expect(contentHashOf(a)).toBe(contentHashOf(b));
  });

  it("HTMLでない本文_生のバイト列のハッシュのまま", () => {
    const md = Buffer.from("# 見出し\n\n本文です。\n");
    expect(isHtml(md)).toBe(false);
    expect(contentHashOf(md)).toBe(rawSha256(md));
  });

  it("HTMLでない本文の空白の違い_違うハッシュ", () => {
    expect(contentHashOf(Buffer.from("a b"))).not.toBe(contentHashOf(Buffer.from("a  b")));
  });

  it("先頭に空白と BOM がある HTML_HTML として扱う", () => {
    expect(isHtml(Buffer.from("﻿ \n<!doctype html><html></html>"))).toBe(true);
  });

  it("main が複数ある HTML_最初の main から最後の main までを取る", () => {
    expect(visibleText("<body>外<main>A</main>間<main>B</main>外2</body>")).toBe("A 間 B");
  });

  it("閉じていない main_main を使わず、head を除いた全体を取る", () => {
    expect(visibleText("<html><head><title>題</title></head><body>外<main>A</body></html>")).toBe("外 A");
  });
});
