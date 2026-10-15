import { describe, expect, it } from "vitest";
import { compareUtf8 } from "./table-double.ts";

describe("代役の並び", () => {
  it("記号と英字と全角_UTF-8 のバイトの順に並べる", () => {
    // `localeCompare` では記号が英字の前後で入れ替わり、全角は言語の規則で並ぶ。バイトの順では、ASCII の符号の順、全角は後ろ
    expect(["b", "_", "B", "あ", "#", "a"].sort(compareUtf8)).toEqual(["#", "B", "_", "a", "b", "あ"]);
  });

  it("サロゲートペアの文字_UTF-16 の順ではなくバイトの順で比べる", () => {
    // U+FF5E(〜 の全角)と U+1F600(絵文字)。UTF-16 では絵文字(0xD83D…)が先、UTF-8 では全角(0xEF…)が先
    expect(compareUtf8("～", "\u{1f600}")).toBeLessThan(0);
    expect("～" < "\u{1f600}").toBe(false);
  });

  it("前方が同じ_短いほうを先にする", () => {
    expect(compareUtf8("RESULT#A", "RESULT#AB")).toBeLessThan(0);
    expect(compareUtf8("RESULT#A", "RESULT#A")).toBe(0);
  });
});
