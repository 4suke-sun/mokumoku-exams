import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DOMAIN_COLOR_COUNT, domainColorClasses, domainColorIndex } from "./domain-color.ts";

const domains = Array.from({ length: 8 }, (_, i) => ({ code: `domain${i + 1}` }));

describe("domainColorIndex", () => {
  it("資格マスタの分野の並び順で決める", () => {
    expect(domainColorIndex(domains, "domain1")).toBe(0);
    expect(domainColorIndex(domains, "domain3")).toBe(2);
  });

  it("色の数より多い分野_先頭の色から繰り返す", () => {
    expect(domainColorIndex(domains, `domain${DOMAIN_COLOR_COUNT + 1}`)).toBe(0);
  });

  it("マスタにない分野_色を付けない", () => {
    expect(domainColorIndex(domains, "unknown")).toBeNull();
    expect(domainColorClasses(domains, "unknown")).toBeNull();
  });

  it("同じ分野_同じクラスを返す", () => {
    expect(domainColorClasses(domains, "domain2")).toEqual({
      text: "text-domain-2",
      border: "border-l-domain-2",
      bar: "bg-domain-2",
    });
  });
});

// globals.css の色の値から、分野の色を文字に使ったときのコントラスト比を確かめる(WCAG AA の 4.5:1)
const css = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

/** セレクターに続く最初の `{ … }` の中の、カスタムプロパティを読む */
function variables(selector: string): Map<string, string> {
  const start = css.indexOf(selector);
  if (start < 0) throw new Error(`見つかりません: ${selector}`);
  const open = css.indexOf("{", start);
  const body = css.slice(open + 1, css.indexOf("}", open));
  return new Map([...body.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1] ?? "", m[2] ?? ""]));
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = Number.parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return ((hi ?? 0) + 0.05) / ((lo ?? 0) + 0.05);
}

describe.each([
  ["ライト", ":root {"],
  ["ダーク(手動)", ':root[data-theme="dark"]'],
  ["ダーク(端末の設定)", ":root:not([data-theme])"],
])("分野の色_%s", (_, selector) => {
  const vars = variables(selector);

  it.each(Array.from({ length: DOMAIN_COLOR_COUNT }, (_, i) => `domain-${i + 1}`))(
    "%s_背景と面の両方で 4.5:1 以上",
    (name) => {
      const color = vars.get(name);
      expect(color).toBeDefined();
      for (const base of ["bg", "surface"]) {
        expect(contrast(color ?? "", vars.get(base) ?? "")).toBeGreaterThanOrEqual(4.5);
      }
    },
  );
});
