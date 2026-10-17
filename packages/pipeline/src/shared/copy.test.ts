import { describe, expect, it } from "vitest";
import { COPY_MAX_CHARS, detectCopy, ORDERED_MIN_TOKENS, orderedTokens } from "./copy.ts";

const BODY = "<p>abcdefghijklmnopqrstuvwxyz0123456789 and more text follows here.</p>";

describe("本文の連続した写しの検出", () => {
  it("上限ちょうどの一致_写しとみなさない。1 文字超えると写しとみなす", () => {
    const plain = "abcdefghijklmnopqrstuvwxyz0123456789";
    expect(detectCopy(plain.slice(0, COPY_MAX_CHARS), [BODY])).toBeNull();
    expect(detectCopy(plain.slice(0, COPY_MAX_CHARS + 1), [BODY])).toBe("verbatim");
  });

  it("途中に別の語が挟まる_一致が分かれるので、写しとみなさない", () => {
    expect(detectCopy("abcdefghijklmnopqrstu-different-vwxyz0123456789", [BODY])).toBeNull();
  });

  it("空白・全角半角・大文字小文字の違い_そろえて比べ、検出する", () => {
    expect(detectCopy("ＡＢＣＤＥ fghijk LMNOP qrstuvwxyz\n0123456789", [BODY])).toBe("verbatim");
  });

  it("日本語_文字数で比べる", () => {
    const body =
      "<p>これは出典の本文にある、とても長い一続きの文であり、三十文字を十分に超える長さを持っています。</p>";
    expect(detectCopy("これは出典の本文にある、とても長い一続きの文であり、三十文字を十分に超える", [body])).toBe(
      "verbatim",
    );
    expect(detectCopy("出典の本文にある、とても長い一続きの文", [body])).toBeNull();
  });

  it("連続一致の上限を渡した_その値で写しを判定する", () => {
    expect(detectCopy("abcdefghijk", [BODY], 10)).toBe("verbatim");
    expect(detectCopy("abcdefghij", [BODY], 10)).toBeNull();
  });

  it("本文が複数_どれかの写しなら検出する", () => {
    expect(detectCopy("abcdefghijk", ["別の本文", BODY], 10)).toBe("verbatim");
  });
});

// 架空の英語の本文。数値と固有名詞が、決まった順で並ぶ
const ENGLISH =
  "<p>Widget Store lets each account create up to 100 buckets per region. Each bucket accepts 3500 PUT requests per second per prefix, " +
  "and Widget Archive stores 5000 objects with 90 days retention in Tier2 and Tier3.</p>";

describe("数値と固有名詞の並びによる写しの検出(言い換えにも効く)", () => {
  const same =
    "Widget Store では 100 個のバケットまで作れ、3500 の PUT を受け付け、Widget Archive は 5000 の保持を 90 日、Tier2 と Tier3 で行う。";
  const reordered = "Tier3 と Tier2 では 90 日、Widget Archive は 5000、Widget Store は 3500 と 100 を PUT とする。";

  it("本文と同じ順に数値・語が並ぶ日本語の言い換え_ordered-terms として検出する", () => {
    expect(orderedTokens(same).length).toBeGreaterThanOrEqual(ORDERED_MIN_TOKENS);
    expect(detectCopy(same, [ENGLISH])).toBe("ordered-terms");
  });

  it("同じ数値・語でも順序が違う_写しとみなさない", () => {
    expect(detectCopy(reordered, [ENGLISH])).toBeNull();
  });

  // 本文の語を 1 つおきに取り、決まった数だけ並べた文(連続した一致にはならない)
  const pick = (count: number) =>
    orderedTokens(ENGLISH)
      .filter((_, i) => i % 2 === 0)
      .slice(0, count)
      .join(" ");

  it("数値・語が下限の 1 つ下_並びが同じでも見ない", () => {
    expect(orderedTokens(pick(ORDERED_MIN_TOKENS - 1))).toHaveLength(ORDERED_MIN_TOKENS - 1);
    expect(detectCopy(pick(ORDERED_MIN_TOKENS - 1), [ENGLISH])).toBeNull();
  });

  it("数値・語が下限ちょうど_並びが同じなら検出する", () => {
    expect(orderedTokens(pick(ORDERED_MIN_TOKENS))).toHaveLength(ORDERED_MIN_TOKENS);
    expect(detectCopy(pick(ORDERED_MIN_TOKENS), [ENGLISH])).toBe("ordered-terms");
  });

  it("本文から離れた範囲に散らばる_近い範囲に並ばないので、写しとみなさない", () => {
    const filler = Array.from({ length: 200 }, (_, i) => `word${i}x`).join(" ");
    const spread = ENGLISH.replace("and Widget Archive", `${filler} and Widget Archive`).replace(
      "Each bucket",
      `${filler} Each bucket`,
    );
    expect(detectCopy(same, [spread])).toBeNull();
  });

  it("結果_種類だけで、一致した文字列を含まない", () => {
    expect(["verbatim", "ordered-terms", null]).toContain(detectCopy(same, [ENGLISH]));
  });
});
