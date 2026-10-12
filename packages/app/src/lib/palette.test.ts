import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { THEME_COLORS } from "./pwa.ts";

// globals.css の色の値(リッチ / シンプル × ライト / ダーク)から、配色の約束を確かめる(docs/app/design-tone.md の「色の変数」)。
// - 文字に使う色は、背景と面の両方に対して 4.5:1 以上(WCAG AA)
// - 正誤・注意・補助色の面は、本文の色と、同じ組の色の両方に対して 4.5:1 以上
// - 面の上の文字(--on-primary)は、主要な色とグラデーションの両端に対して 4.5:1 以上
// - ライトの背景はホワイト。カードは、影か縁で、背景と区別できる
// - 端末の設定に従うブロックと、手動の選択のブロックで、値が食い違わない

const css = readFileSync(resolve(import.meta.dirname, "../app/globals.css"), "utf8");

/** セレクターの直後の `{ … }` の中の、色(#rrggbb)のカスタムプロパティと、影の値を読む */
function block(selector: string): Map<string, string> {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = new RegExp(`(^|\\n)\\s*${escaped}\\s*\\{`).exec(css);
  if (!match) throw new Error(`見つかりません: ${selector}`);
  const open = css.indexOf("{", match.index);
  // ブロックの中に、入れ子の波括弧はない(最初の閉じ括弧が、ブロックの終わり)
  const body = css.slice(open + 1, css.indexOf("}", open));
  return new Map([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1] ?? "", (m[2] ?? "").trim()]));
}

const overlay = (...maps: Map<string, string>[]) => new Map(maps.flatMap((m) => [...m]));

const richLight = block(":root");
const richDarkManual = block(':root[data-theme="dark"]');
const richDarkSystem = block(":root:not([data-theme])");
const simpleLightOwn = block(':root[data-style="simple"]');
const simpleDarkManualOwn = block(':root[data-style="simple"][data-theme="dark"]');
const simpleDarkSystemOwn = block(':root[data-style="simple"]:not([data-theme])');

/** 4 通りの値(シンプルは、リッチの値に、自分の値を重ねたもの) */
const MODES: [string, Map<string, string>][] = [
  ["リッチ × ライト", richLight],
  ["リッチ × ダーク", richDarkManual],
  ["シンプル × ライト", overlay(richLight, simpleLightOwn)],
  ["シンプル × ダーク", overlay(richDarkManual, simpleDarkManualOwn)],
];

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

/** `color-mix(in srgb, a <percent>%, b)` と同じ混ぜ方(sRGB の各成分を、割合で混ぜる) */
function mix(a: string, percent: number, b: string): string {
  const channel = (i: number) => {
    const ca = Number.parseInt(a.slice(i, i + 2), 16);
    const cb = Number.parseInt(b.slice(i, i + 2), 16);
    return Math.round((ca * percent) / 100 + (cb * (100 - percent)) / 100)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(1)}${channel(3)}${channel(5)}`;
}

const color = (vars: Map<string, string>, name: string): string => {
  const value = vars.get(name);
  if (!value || !/^#[0-9a-f]{6}$/i.test(value)) throw new Error(`色の値がありません: --${name}`);
  return value;
};

/** 文字に使う色 */
const TEXT_COLORS = [
  "text",
  "muted",
  "primary",
  "correct",
  "incorrect",
  "warn",
  "violet",
  "orange",
  ...[1, 2, 3, 4, 5, 6].map((n) => `domain-${n}`),
];

/** 面の色と、その上に載せる、同じ組の文字の色 */
const SURFACE_PAIRS: [string, string][] = [
  ["correct-bg", "correct"],
  ["incorrect-bg", "incorrect"],
  ["warn-bg", "warn"],
  ["soft", "primary"],
  ["violet-soft", "violet"],
  ["orange-soft", "orange"],
];

/** ラベル(.chip)の色の段階 */
const TONES = [
  "primary",
  "correct",
  "incorrect",
  "warn",
  "violet",
  "orange",
  "muted",
  "domain-1",
  "domain-2",
  "domain-3",
  "domain-4",
  "domain-5",
  "domain-6",
];

describe.each(MODES)("配色_%s", (_, vars) => {
  it("文字に使う色_背景と面の両方で 4.5:1 以上", () => {
    for (const name of TEXT_COLORS) {
      for (const base of ["bg", "surface"]) {
        expect(contrast(color(vars, name), color(vars, base)), `--${name} と --${base}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("正誤・注意・補助色の面_本文の色と同じ組の色の両方で 4.5:1 以上", () => {
    for (const [surface, pair] of SURFACE_PAIRS) {
      expect(contrast(color(vars, surface), color(vars, "text")), `--${surface} と --text`).toBeGreaterThanOrEqual(4.5);
      expect(contrast(color(vars, surface), color(vars, pair)), `--${surface} と --${pair}`).toBeGreaterThanOrEqual(
        4.5,
      );
    }
  });

  it("面の上の文字_主要な色とグラデーションの両端に対して 4.5:1 以上", () => {
    for (const name of ["primary", "accent-from", "accent-to"]) {
      expect(
        contrast(color(vars, "on-primary"), color(vars, name)),
        `--on-primary と --${name}`,
      ).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("面が背景から浮いて見える_正誤・注意・補助色の面は、背景と違う色", () => {
    for (const [surface] of SURFACE_PAIRS) {
      expect(color(vars, surface).toLowerCase(), `--${surface}`).not.toBe(color(vars, "bg").toLowerCase());
    }
  });

  it("ラベル(.chip)_色の段階ごとに、面と文字が 4.5:1 以上", () => {
    for (const tone of TONES) {
      const toneColor = color(vars, tone);
      const face = mix(toneColor, 16, color(vars, "surface"));
      const text = mix(toneColor, 80, color(vars, "text"));
      expect(contrast(face, text), `.chip の ${tone}`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("ライトの背景とカード", () => {
  it("リッチ・シンプルのライト_ページの背景はホワイト", () => {
    for (const [name, vars] of MODES.filter(([n]) => n.includes("ライト"))) {
      expect(color(vars, "bg").toLowerCase(), name).toBe("#ffffff");
    }
  });

  it("ブラウザのバーの色_ページの背景と同じ(ライトはホワイト、ダークはリッチのダークの背景)", () => {
    expect(THEME_COLORS.light.toLowerCase()).toBe(color(richLight, "bg").toLowerCase());
    expect(THEME_COLORS.dark.toLowerCase()).toBe(color(richDarkManual, "bg").toLowerCase());
  });

  it("リッチ × ライト_カードは影と縁で背景と区別する", () => {
    expect(richLight.get("shadow-card")).not.toBe("none");
    expect(contrast(color(richLight, "border"), color(richLight, "bg"))).toBeGreaterThanOrEqual(1.5);
  });

  it("シンプル × ライト_影がないので、縁で背景と区別する(縁は、ホワイトに対して 1.5:1 以上)", () => {
    const vars = overlay(richLight, simpleLightOwn);
    expect(vars.get("shadow-card")).toBe("none");
    expect(contrast(color(vars, "border"), color(vars, "bg"))).toBeGreaterThanOrEqual(1.5);
  });

  it("ダーク_面は背景と違う色で、縁も背景と区別できる", () => {
    for (const [name, vars] of MODES.filter(([n]) => n.includes("ダーク"))) {
      expect(color(vars, "surface").toLowerCase(), name).not.toBe(color(vars, "bg").toLowerCase());
      expect(contrast(color(vars, "border"), color(vars, "bg")), name).toBeGreaterThanOrEqual(1.5);
    }
  });
});

describe("端末の設定に従うブロックと手動の選択", () => {
  it("リッチのダーク_同じ役割の値がすべて同じ", () => {
    for (const [name, value] of richDarkManual) {
      expect(richDarkSystem.get(name), `--${name}`).toBe(value);
    }
    expect([...richDarkSystem.keys()].sort()).toEqual([...richDarkManual.keys()].sort());
  });

  it("シンプルのダーク_同じ役割の値がすべて同じ", () => {
    for (const [name, value] of simpleDarkManualOwn) {
      expect(simpleDarkSystemOwn.get(name), `--${name}`).toBe(value);
    }
    expect([...simpleDarkSystemOwn.keys()].sort()).toEqual([...simpleDarkManualOwn.keys()].sort());
  });

  it("4 通りすべてが_同じ役割の色の組を持つ", () => {
    const roles = [
      ...TEXT_COLORS,
      "bg",
      "surface",
      "border",
      "on-primary",
      "accent-from",
      "accent-to",
      ...SURFACE_PAIRS.map(([s]) => s),
    ];
    for (const [name, vars] of MODES) {
      for (const role of roles) expect(vars.has(role), `${name} の --${role}`).toBe(true);
    }
  });
});
