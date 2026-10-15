import { describe, expect, it } from "vitest";
import { decodeEntities, normalize } from "./text.ts";

describe("文字参照", () => {
  it("名前付きの参照と数値の参照_文字に戻す", () => {
    expect(decodeEntities("A&nbsp;B &amp; C &lt;x&gt; &#39;q&#39; &#x41;")).toBe("A B & C <x> 'q' A");
  });

  it("知らない名前と範囲の外の数値_そのまま残す", () => {
    expect(decodeEntities("&unknown; &#0; &#x110000;")).toBe("&unknown; &#0; &#x110000;");
  });

  it("見出しに文字参照がある_正規化で空白にそろい、見出しの文と比べられる", () => {
    expect(normalize("<h2>Generative AI&nbsp;</h2>")).toBe("generative ai");
  });
});
