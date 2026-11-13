import { describe, expect, it } from "vitest";
import {
  ALLOWED,
  type Allow,
  checkAllowList,
  checkUiPatterns,
  findAll,
  isTarget,
  RULE_LABELS,
  RULES,
  type RuleId,
  stripComments,
} from "./ui-patterns-check.ts";

const TSX = "packages/app/src/components/sample.tsx";
const CSS = "packages/app/src/app/globals.css";

/** 1 つのファイルから、ある規則の指摘の行番号を取り出す */
function lines(rule: RuleId, text: string, file = TSX): number[] {
  return findAll([{ file, text }])
    .filter((f) => f.rule === rule)
    .map((f) => f.line);
}

describe("transition-all", () => {
  it("クラスに transition-all がある_指摘する", () => {
    expect(lines("transition-all", `<a className="transition-all duration-200">x</a>`)).toEqual([1]);
  });

  it("CSS に transition: all がある_指摘する", () => {
    expect(lines("transition-all", `a {\n  transition: all 0.2s;\n}`, CSS)).toEqual([2]);
  });

  it("プロパティを指定した遷移_指摘しない", () => {
    expect(lines("transition-all", `a {\n  transition: border-color 0.2s;\n}`, CSS)).toEqual([]);
    expect(lines("transition-all", `<a className="transition-colors">x</a>`)).toEqual([]);
  });
});

describe("hover-motion", () => {
  it("ホバーで拡大するクラス_指摘する", () => {
    expect(lines("hover-motion", `<a className="hover:scale-105">x</a>`)).toEqual([1]);
    expect(lines("hover-motion", `<a className="group-hover:-translate-y-1">x</a>`)).toEqual([1]);
  });

  it("CSS の :hover と :active で transform を動かす_指摘する", () => {
    const css = `a:hover {\n  transform: translateY(-2px);\n}\na:active {\n  transform: scale(0.98);\n}`;
    expect(lines("hover-motion", css, CSS)).toEqual([1, 4]);
  });

  it("ホバーで色だけを変える_指摘しない", () => {
    expect(lines("hover-motion", `<a className="hover:bg-soft hover:underline">x</a>`)).toEqual([]);
    expect(
      lines("hover-motion", `a:hover {\n  border-color: var(--primary);\n}\na:hover {\n  transform: none;\n}`, CSS),
    ).toEqual([]);
  });
});

describe("infinite-animation", () => {
  it("CSS の animation に infinite がある_infinite のある行を指摘する", () => {
    const css = `.a {\n  animation:\n    grow 8s forwards,\n    flow 1s linear infinite;\n}`;
    expect(lines("infinite-animation", css, CSS)).toEqual([4]);
  });

  it("一度だけの animation_指摘しない", () => {
    expect(lines("infinite-animation", `.a {\n  animation: fade 0.3s ease-out backwards;\n}`, CSS)).toEqual([]);
  });

  it("animate-pulse などのクラス_指摘する", () => {
    expect(lines("infinite-animation", `<div className="animate-pulse" />`)).toEqual([1]);
    expect(lines("infinite-animation", `<div className="animate-bounce" />`)).toEqual([1]);
  });
});

describe("overshoot-easing", () => {
  it("cubic-bezier の y が 1 を超える_指摘する", () => {
    expect(
      lines("overshoot-easing", `.a {\n  transition: transform 1s cubic-bezier(0.3, 1.2, 0.5, 1);\n}`, CSS),
    ).toEqual([2]);
  });

  it("cubic-bezier の y が 0 より小さい_指摘する", () => {
    expect(lines("overshoot-easing", `.a {\n  animation: x 1s cubic-bezier(0.3, -0.5, 0.5, 1);\n}`, CSS)).toEqual([2]);
  });

  it("y が 0 から 1 の中_指摘しない", () => {
    expect(lines("overshoot-easing", `.a {\n  animation: x 1s cubic-bezier(0.2, 0.8, 0.2, 1);\n}`, CSS)).toEqual([]);
  });
});

describe("layout-motion", () => {
  it("transition に width がある_指摘する", () => {
    expect(lines("layout-motion", `.a {\n  transition: width 0.4s ease;\n}`, CSS)).toEqual([2]);
  });

  it("複数行の transition_当たった行を指摘する", () => {
    const css = `.a {\n  transition:\n    transform 0.3s ease,\n    height 0.2s ease-out;\n}`;
    expect(lines("layout-motion", css, CSS)).toEqual([4]);
  });

  it("keyframes の中で left を動かす_keyframes の行を指摘する", () => {
    expect(lines("layout-motion", `@keyframes slide {\n  from {\n    left: 0;\n  }\n}`, CSS)).toEqual([1]);
  });

  it("transform と opacity だけの遷移_指摘しない", () => {
    expect(lines("layout-motion", `.a {\n  transition: transform 0.3s ease, opacity 0.2s ease;\n}`, CSS)).toEqual([]);
    expect(lines("layout-motion", `@keyframes up {\n  from {\n    transform: translateY(8px);\n  }\n}`, CSS)).toEqual(
      [],
    );
  });

  it("背景色の遷移で border-color と background-color を使う_指摘しない", () => {
    expect(lines("layout-motion", `.a {\n  transition: border-color 0.2s, background-color 0.2s;\n}`, CSS)).toEqual([]);
  });
});

describe("文字の太さ・斜体・字間", () => {
  it("font-black と font-extrabold_極太として指摘する", () => {
    expect(lines("heavy-weight", `<b className="font-black">x</b>\n<b className="font-extrabold">y</b>`)).toEqual([
      1, 2,
    ]);
    expect(lines("heavy-weight", `.a {\n  font-weight: 900;\n}`, CSS)).toEqual([2]);
  });

  it("font-bold と font-normal_指摘しない", () => {
    expect(lines("heavy-weight", `<b className="font-bold font-normal">x</b>`)).toEqual([]);
    expect(lines("weight-steps", `<b className="font-bold font-normal">x</b>`)).toEqual([]);
  });

  it("font-medium と font-semibold と font-weight: 500_太さの段階として指摘する", () => {
    expect(lines("weight-steps", `<b className="font-medium">x</b>\n<i className="font-semibold">y</i>`)).toEqual([
      1, 2,
    ]);
    expect(lines("weight-steps", `.a {\n  font-weight: 500;\n}`, CSS)).toEqual([2]);
  });

  it("italic と em タグ_斜体として指摘する", () => {
    expect(lines("italic", `<p className="italic">x</p>`)).toEqual([1]);
    expect(lines("italic", `<p><em>x</em></p>`)).toEqual([1]);
    expect(lines("italic", `.a {\n  font-style: italic;\n}`, CSS)).toEqual([2]);
  });

  it("italicize という語や img タグ_指摘しない", () => {
    expect(lines("italic", `const italicize = 1;\n<img src="a" alt="" />`)).toEqual([]);
  });

  it("uppercase と tracking-wide と letter-spacing_指摘する", () => {
    expect(lines("case-tracking", `<p className="uppercase tracking-wide">x</p>`)).toEqual([1]);
    expect(lines("case-tracking", `.a {\n  letter-spacing: 0.1em;\n}`, CSS)).toEqual([2]);
    expect(lines("case-tracking", `.a {\n  text-transform: uppercase;\n}`, CSS)).toEqual([2]);
  });

  it("tracking-normal_指摘しない", () => {
    expect(lines("case-tracking", `<p className="tracking-normal">x</p>`)).toEqual([]);
  });
});

describe("fullwidth-exclamation", () => {
  it("文言に全角の「！」_指摘する", () => {
    expect(lines("fullwidth-exclamation", `const a = "完了しました！";`)).toEqual([1]);
  });

  it("コメントの中の「！」と半角の「!」_指摘しない", () => {
    expect(lines("fullwidth-exclamation", `// 全角の！は使わない\nconst a = "!";`)).toEqual([]);
  });
});

describe("gradient", () => {
  it("linear-gradient と bg-gradient-to と bg-clip-text_指摘する", () => {
    expect(lines("gradient", `.a {\n  background: linear-gradient(135deg, red, blue);\n}`, CSS)).toEqual([2]);
    expect(lines("gradient", `<p className="bg-gradient-to-r from-blue-500">x</p>`)).toEqual([1]);
    expect(lines("gradient", `<p className="bg-clip-text text-transparent">x</p>`)).toEqual([1]);
  });

  it("コメントの中の語_指摘しない", () => {
    expect(lines("gradient", `/* linear-gradient は使わない */\n.a {\n  color: red;\n}`, CSS)).toEqual([]);
  });
});

describe("glow-shadow", () => {
  it("ずれがなく、ぼかしのある影_光る影として指摘する(複数の影でも 1 行は 1 件)", () => {
    const css = `.a {\n  box-shadow:\n    0 0 10px var(--primary),\n    0 0 4px var(--primary);\n}`;
    expect(lines("glow-shadow", css, CSS)).toEqual([2]);
  });

  it("広がりだけの輪と、ずれのある影_指摘しない", () => {
    expect(lines("glow-shadow", `.a {\n  box-shadow: 0 0 0 4px var(--primary);\n}`, CSS)).toEqual([]);
    expect(
      lines("glow-shadow", `.a {\n  box-shadow: 0 1px 2px rgb(0 0 0 / 0.3), 0 4px 14px rgb(0 0 0 / 0.2);\n}`, CSS),
    ).toEqual([]);
  });

  it("任意値の影と drop-shadow と blur_指摘する", () => {
    expect(lines("glow-shadow", `<p className="shadow-[0_0_8px_blue]">x</p>`)).toEqual([1]);
    expect(lines("glow-shadow", `<p className="drop-shadow-lg">x</p>`)).toEqual([1]);
    expect(lines("glow-shadow", `<p className="blur-sm">x</p>`)).toEqual([1]);
  });

  it("backdrop-blur と onBlur と blur()_指摘しない", () => {
    expect(lines("glow-shadow", `<p className="backdrop-blur" onBlur={() => el.blur()}>x</p>`)).toEqual([]);
  });
});

describe("odd-spacing", () => {
  it("py-1.5 と gap-2.5 と mt-3.5_4px の刻みにないので指摘する", () => {
    expect(lines("odd-spacing", `<p className="py-1.5">x</p>`)).toEqual([1]);
    expect(lines("odd-spacing", `<p className="flex gap-2.5">x</p>`)).toEqual([1]);
    expect(lines("odd-spacing", `<p className="sm:-mt-3.5">x</p>`)).toEqual([1]);
  });

  it("余白の任意値_指摘する", () => {
    expect(lines("odd-spacing", `<p className="p-[7px]">x</p>`)).toEqual([1]);
  });

  it("4px の刻みと 2px(0.5)_指摘しない", () => {
    expect(lines("odd-spacing", `<p className="py-2 gap-3 px-4 pt-0.5 space-y-0.5">x</p>`)).toEqual([]);
  });

  it("余白でないクラス(h-1.5 と top-0.5)_指摘しない", () => {
    expect(lines("odd-spacing", `<p className="h-1.5 top-0.5 size-2.5">x</p>`)).toEqual([]);
  });

  it("CSS の padding が 4px の刻みでない_指摘する", () => {
    expect(lines("odd-spacing", `.a {\n  padding: 0.125rem 0.625rem;\n}`, CSS)).toEqual([2]);
    expect(lines("odd-spacing", `.a {\n  margin-top: 6px;\n}`, CSS)).toEqual([2]);
  });

  it("CSS の padding が 4px の刻みか 0_指摘しない", () => {
    expect(
      lines("odd-spacing", `.a {\n  padding: 0.25rem 0.75rem;\n  margin: 0 auto;\n  gap: 0.5rem;\n}`, CSS),
    ).toEqual([]);
  });
});

describe("waiting-message", () => {
  it("ここに結果が表示されます_待機メッセージとして指摘する", () => {
    expect(lines("waiting-message", `<p>問題を解くと、ここに結果が表示されます。</p>`)).toEqual([1]);
    expect(lines("waiting-message", `description="間違えた問題があると、ここに並びます。"`)).toEqual([1]);
    expect(lines("waiting-message", `<p>合格予測がここに出ます。</p>`)).toEqual([1]);
  });

  it("ここに別の意味で使う文_指摘しない", () => {
    expect(
      lines("waiting-message", `// ここにないものは、利用できないとして扱う\nconst a = "ここに含められない";`),
    ).toEqual([]);
  });

  it("状態を述べる文と、次にすることを促す文_指摘しない", () => {
    expect(lines("waiting-message", `<p>まだ受験した結果がありません。問題を解いてください。</p>`)).toEqual([]);
  });
});

describe("badge-words", () => {
  it("NEW や おすすめ のバッジ_指摘する", () => {
    expect(lines("badge-words", `<span className="chip">NEW</span>`)).toEqual([1]);
    expect(lines("badge-words", `<span className="chip">おすすめ</span>`)).toEqual([1]);
  });

  it("NEW_PASSWORD_REQUIRED のような識別子_指摘しない", () => {
    expect(lines("badge-words", `const a = "NEW_PASSWORD_REQUIRED";`)).toEqual([]);
  });
});

describe("emoji", () => {
  it("絵文字_指摘する", () => {
    expect(lines("emoji", `const a = "🎉";`)).toEqual([1]);
    expect(lines("emoji", `<span>✅</span>`)).toEqual([1]);
  });

  it("文字の記号(★・▶・☰・✓・○・×)_指摘しない", () => {
    expect(lines("emoji", `const a = "★ ▶ ☰ ✓ ○ × ✕ ● ▽";`)).toEqual([]);
  });
});

describe("rounded-full と border-l-thick", () => {
  it("rounded-full と 9999px の角丸_指摘する", () => {
    expect(lines("rounded-full", `<a className="rounded-full">x</a>`)).toEqual([1]);
    expect(lines("rounded-full", `.a {\n  border-radius: 9999px;\n}`, CSS)).toEqual([2]);
  });

  it("rounded-md_指摘しない", () => {
    expect(lines("rounded-full", `<a className="rounded-md">x</a>`)).toEqual([]);
  });

  it("border-l-4 と CSS の border-left: 4px_指摘する", () => {
    expect(lines("border-l-thick", `<a className="card border-l-4 border-l-primary">x</a>`)).toEqual([1]);
    expect(lines("border-l-thick", `.a {\n  border-left: 4px solid var(--primary);\n}`, CSS)).toEqual([2]);
  });

  it("色だけの border-l-primary と、細い border-l_指摘しない", () => {
    expect(lines("border-l-thick", `<a className="border-l border-l-primary">x</a>`)).toEqual([]);
    expect(lines("border-l-thick", `.a {\n  border-left: 1px solid var(--border);\n}`, CSS)).toEqual([]);
  });
});

describe("hardcoded-color", () => {
  it("クラスの bg-black と palette の色と、文字列の 16 進の色_指摘する", () => {
    expect(lines("hardcoded-color", `<div className="bg-black/40" />`)).toEqual([1]);
    expect(lines("hardcoded-color", `<div className="text-blue-500" />`)).toEqual([1]);
    expect(lines("hardcoded-color", `const c = "#12151a";`)).toEqual([1]);
    expect(lines("hardcoded-color", `const c = "rgb(0 0 0)";`)).toEqual([1]);
  });

  it("役割の色のクラスと、アンカーの href_指摘しない", () => {
    expect(lines("hardcoded-color", `<a href="#main" className="bg-orange text-violet bg-surface">x</a>`)).toEqual([]);
  });

  it("CSS に変数の定義と宣言の中の直書きがある_定義は数えず直書きだけを指摘する", () => {
    const css = `:root {\n  --bg: #ffffff;\n}\n.a {\n  background: #ffffff;\n  color: var(--text);\n}`;
    expect(lines("hardcoded-color", css, CSS)).toEqual([5]);
  });
});

describe("body-line-height", () => {
  it("body の行間が 1.7〜1.85_指摘しない", () => {
    expect(lines("body-line-height", `body {\n  line-height: 1.75;\n}`, CSS)).toEqual([]);
    expect(lines("body-line-height", `body {\n  line-height: 1.7;\n}`, CSS)).toEqual([]);
    expect(lines("body-line-height", `body {\n  line-height: 1.85;\n}`, CSS)).toEqual([]);
  });

  it("body の行間が 1.5 と 2_指摘する", () => {
    expect(lines("body-line-height", `body {\n  line-height: 1.5;\n}`, CSS)).toEqual([1]);
    expect(lines("body-line-height", `body {\n  line-height: 2;\n}`, CSS)).toEqual([1]);
  });

  it("globals.css に body の行間がない_1 行目を指摘する", () => {
    expect(lines("body-line-height", `body {\n  color: red;\n}`, CSS)).toEqual([1]);
  });

  it("ほかの CSS に body の行間がない_指摘しない", () => {
    expect(lines("body-line-height", `.a {\n  color: red;\n}`, "packages/app/src/app/other.css")).toEqual([]);
  });
});

describe("heading-note", () => {
  it("見出しの直下の text-xs と text-muted の行_指摘する", () => {
    const tsx = `<h2 className="h2">題</h2>\n<p className="text-xs text-muted">小さな注記</p>`;
    expect(lines("heading-note", tsx)).toEqual([1]);
  });

  it("見出しの直下の text-sm の説明文_指摘しない", () => {
    const tsx = `<h1 className="h1">題</h1>\n<p className="text-sm text-muted">説明</p>`;
    expect(lines("heading-note", tsx)).toEqual([]);
  });

  it("見出しと離れた text-xs の行_指摘しない", () => {
    const tsx = `<h2 className="h2">題</h2>\n<ul><li>項目</li></ul>\n<p className="text-xs text-muted">凡例</p>`;
    expect(lines("heading-note", tsx)).toEqual([]);
  });
});

describe("stripComments", () => {
  it("ブロックコメントと行コメント_中身を空白にして行番号を保つ", () => {
    const out = stripComments(`a /* x\ny */ b\n// c\nd`, "code");
    expect(out.split("\n")).toHaveLength(4);
    expect(out).not.toContain("x");
    expect(out).not.toContain("c");
    expect(out).toContain("b");
    expect(out).toContain("d");
  });

  it("URL の // と CSS の行頭の語_コードの中身を消さない", () => {
    expect(stripComments(`const u = "https://example.com";`, "code")).toContain("https://example.com");
  });

  it("コメントの中の語_規則に当たらない", () => {
    expect(lines("italic", `// italic は使わない\n/* font-black */\nconst a = 1;`)).toEqual([]);
  });
});

describe("isTarget", () => {
  it("アプリの画面の部品と CSS_対象にする", () => {
    expect(isTarget("packages/app/src/components/a.tsx")).toBe(true);
    expect(isTarget("packages/app/src/app/globals.css")).toBe(true);
    expect(isTarget("packages/app/src/lib/pwa.ts")).toBe(true);
  });

  it("テストと型定義とテスト用の設定と、アプリの外_対象にしない", () => {
    expect(isTarget("packages/app/src/components/a.test.tsx")).toBe(false);
    expect(isTarget("packages/app/src/lib/a.test.ts")).toBe(false);
    expect(isTarget("packages/app/src/types/web-push.d.ts")).toBe(false);
    expect(isTarget("packages/app/src/test/setup.ts")).toBe(false);
    expect(isTarget("packages/app/e2e/smoke.spec.ts")).toBe(false);
    expect(isTarget("packages/pipeline/src/a.ts")).toBe(false);
    expect(isTarget("packages/app/src/components/a.md")).toBe(false);
  });
});

describe("checkUiPatterns と許可の一覧", () => {
  const source = { file: TSX, text: `<p className="font-black">a</p>\n<p className="font-black">b</p>` };
  const allow = (over: Partial<Allow> = {}): Allow => ({
    rule: "heavy-weight",
    file: TSX,
    count: 2,
    reason: "テスト用の理由",
    ...over,
  });

  it("許可のない指摘_場所と種類を報告する(値は引用しない)", () => {
    const { errors } = checkUiPatterns([source], []);
    expect(errors).toEqual([`${TSX}:1: 極太の文字`, `${TSX}:2: 極太の文字`]);
  });

  it("許可の件数が実際と同じ_エラーにしない", () => {
    expect(checkUiPatterns([source], [allow()])).toEqual({ errors: [], allowed: 2 });
  });

  it("許可の件数より指摘が多い_件数の食い違いと、はみ出した指摘を報告する", () => {
    const { errors } = checkUiPatterns([source], [allow({ count: 1 })]);
    expect(errors).toEqual([expect.stringContaining("件数が合わない"), `${TSX}:2: 極太の文字`]);
  });

  it("許可の件数より指摘が少ない_古い許可として報告する", () => {
    const { errors } = checkUiPatterns([source], [allow({ count: 3 })]);
    expect(errors).toEqual([expect.stringContaining("実際は 2 件")]);
  });

  it("指摘のないファイルの許可_古い許可として報告する", () => {
    const { errors } = checkUiPatterns([{ file: TSX, text: "const a = 1;" }], [allow()]);
    expect(errors).toEqual([expect.stringContaining("実際は 0 件")]);
  });

  it("許可に match を付ける_その文字を含む行だけを数える", () => {
    const { errors } = checkUiPatterns(
      [source],
      [allow({ count: 1, match: "a</p>" }), allow({ count: 1, match: "b</p>" })],
    );
    expect(errors).toEqual([]);
  });

  it("許可の規則やファイルが違う_許可にならない", () => {
    const { errors } = checkUiPatterns([source], [allow({ file: "packages/app/src/components/other.tsx" })]);
    expect(errors.some((e) => e.startsWith(`${TSX}:1:`))).toBe(true);
  });

  it("理由が空の許可と件数が不正な許可と重複_一覧の誤りとして報告する", () => {
    expect(checkAllowList([allow({ reason: "  " })])).toEqual([expect.stringContaining("理由が空")]);
    expect(checkAllowList([allow({ count: 0 })])).toEqual([expect.stringContaining("件数")]);
    expect(checkAllowList([allow(), allow()])).toEqual([expect.stringContaining("重複")]);
    expect(checkAllowList([allow({ rule: "nothing" as RuleId })])).toEqual([expect.stringContaining("規則の名前")]);
  });

  it("実際の許可の一覧_すべて理由があり、対象のファイルを指す", () => {
    expect(checkAllowList(ALLOWED)).toEqual([]);
    for (const a of ALLOWED) {
      expect(isTarget(a.file), a.file).toBe(true);
      expect(a.reason.length, `${a.file} の理由`).toBeGreaterThanOrEqual(10);
    }
  });

  it("規則の一覧_報告に使う種類の名前を、すべての規則が持つ", () => {
    for (const rule of RULES) expect(RULE_LABELS[rule].length, rule).toBeGreaterThan(0);
  });
});
