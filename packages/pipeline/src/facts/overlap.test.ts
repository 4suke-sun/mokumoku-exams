import { describe, expect, it } from "vitest";
import { COPY_MAX_CHARS, hasLongCopy } from "./overlap.ts";

const BODY = "<p>abcdefghijklmnopqrstuvwxyz0123456789 and more text follows here.</p>";

describe("本文の長い写しの検出", () => {
  it("上限ちょうどの一致_写しとみなさない。1 文字超えると写しとみなす", () => {
    const plain = "abcdefghijklmnopqrstuvwxyz0123456789";
    expect(hasLongCopy(plain.slice(0, COPY_MAX_CHARS), BODY)).toBe(false);
    expect(hasLongCopy(plain.slice(0, COPY_MAX_CHARS + 1), BODY)).toBe(true);
  });

  it("途中に別の語が挟まる_一致が分かれるので、写しとみなさない", () => {
    const text = `abcdefghijklmnopqrstu-different-vwxyz0123456789`;
    expect(hasLongCopy(text, BODY)).toBe(false);
  });

  it("空白・全角半角・大文字小文字の違い_そろえて比べ、検出する", () => {
    const text = "ＡＢＣＤＥ fghijk LMNOP qrstuvwxyz\n0123456789";
    expect(hasLongCopy(text, BODY)).toBe(true);
  });

  it("日本語_文字数で比べる", () => {
    const body =
      "<p>これは出典の本文にある、とても長い一続きの文であり、三十文字を十分に超える長さを持っています。</p>";
    expect(hasLongCopy("これは出典の本文にある、とても長い一続きの文であり、三十文字を十分に超える", body)).toBe(true);
    expect(hasLongCopy("出典の本文にある、とても長い一続きの文", body)).toBe(false);
  });

  it("上限を指定できる", () => {
    expect(hasLongCopy("abcdefghijk", BODY, 10)).toBe(true);
    expect(hasLongCopy("abcdefghij", BODY, 10)).toBe(false);
  });

  it("結果_真偽だけで、一致した文字列を含まない", () => {
    expect(typeof hasLongCopy("abcdefghijklmnopqrstuvwxyz0123456789", BODY)).toBe("boolean");
  });
});
