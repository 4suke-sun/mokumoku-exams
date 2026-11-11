/**
 * 画面の書き方の型の検査(docs/app/design-tone.md の「型を除く決まり」)。
 * アプリ(packages/app/src)の画面の部品と CSS を、文字列として静的に走査し、
 * 「AI が作った感じ」を出す書き方の型(transition: all、無限に繰り返す動き、極太、斜体、英字の大文字と字間、
 * 全角の「！」、グラデーション、半端な余白、待機メッセージの文型など)を拾う。
 * 純粋な関数にして単体テストする(ファイルの読み込みは scripts/check-ui-patterns.ts)。
 * 報告は、場所(ファイル:行)と種類だけ。見た目の良し悪しは、人が全画面で確かめる。
 *
 * 意図して残す箇所は、下の ALLOWED に、理由つきで置く(ファイル・規則・件数で縛る)。
 * 件数が合わないと止める(足したときも、消したときも)ので、許可の一覧は実装と食い違わない。
 * 検査の限界: コメントを取り除く処理は簡易版(行頭または空白のあとの `//` と、`/* … *\/`)。
 * 文字列を組み立てて作るクラス名(`border-l-${…}` など)は読み取れない。
 */

export interface Source {
  file: string;
  text: string;
}

export interface Finding {
  rule: RuleId;
  file: string;
  line: number;
  /** 見つかった行(前後の空白を除く)。許可の一覧の `match` と照合する */
  text: string;
}

export interface Allow {
  rule: RuleId;
  /** 許可するファイル(リポジトリのパス) */
  file: string;
  /** 許可する件数(行の数)。実際の件数と違うと、一覧が古いものとして止める */
  count: number;
  /** 指定すると、見つかった行にこの文字列を含むものだけを数える */
  match?: string;
  /** 意図して残す理由(必須) */
  reason: string;
}

export const RULES = [
  "transition-all",
  "hover-motion",
  "infinite-animation",
  "overshoot-easing",
  "layout-motion",
  "heavy-weight",
  "weight-steps",
  "italic",
  "case-tracking",
  "fullwidth-exclamation",
  "gradient",
  "glow-shadow",
  "odd-spacing",
  "waiting-message",
  "badge-words",
  "emoji",
  "rounded-full",
  "border-l-thick",
  "hardcoded-color",
  "body-line-height",
  "heading-note",
] as const;

export type RuleId = (typeof RULES)[number];

/** 規則ごとの、報告に出す種類の名前(場所と種類だけを報告する) */
export const RULE_LABELS: Record<RuleId, string> = {
  "transition-all": "すべてのプロパティの遷移(transition: all)",
  "hover-motion": "ホバーで拡大・移動する動き",
  "infinite-animation": "無限に繰り返す動き",
  "overshoot-easing": "行き過ぎて戻るイージング(跳ねる動き)",
  "layout-motion": "幅・高さ・位置の遷移",
  "heavy-weight": "極太の文字",
  "weight-steps": "太さの 3 段階目以降(通常と太字の 2 段階まで)",
  italic: "斜体",
  "case-tracking": "英字の大文字・字間の飾り",
  "fullwidth-exclamation": "全角の「！」",
  gradient: "グラデーション",
  "glow-shadow": "光る影・ぼかし",
  "odd-spacing": "4px の刻みにない余白",
  "waiting-message": "待機メッセージの文型(「ここに…表示されます」)",
  "badge-words": "目を引くバッジの語(NEW・おすすめなど)",
  emoji: "絵文字",
  "rounded-full": "丸い錠剤形(rounded-full)",
  "border-l-thick": "カードの 1 辺だけの太い色線",
  "hardcoded-color": "色の値の直書き(変数を使わない)",
  "body-line-height": "本文の行間が 1.7〜1.85 の外",
  "heading-note": "見出しの直下の小さな注記(text-xs の補助色)",
};

export const LINE_HEIGHT_MIN = 1.7;
export const LINE_HEIGHT_MAX = 1.85;

/** 絵文字に数えない記号(文字の記号として使う。意味は文字でも伝える) */
const MARKS = /★|▶|☰|\uFE0F|\u200D/gu;

/** 4px の刻みの余白(Tailwind の 1 = 4px)。2px(0.5)は、線・点と文字の位置合わせの微調整に限り、許す */
const GRID_PX = 4;

type Kind = "css" | "code";

interface Prepared {
  file: string;
  kind: Kind;
  /** コメントを取り除いた本文(行の位置は保つ) */
  clean: string;
  lines: string[];
}

/** コメントの中身を空白にする(改行は残すので、行番号がずれない) */
export function stripComments(text: string, kind: Kind): string {
  const blank = (s: string) => s.replace(/[^\n]/g, " ");
  let out = text.replace(/\/\*[\s\S]*?\*\//g, blank);
  if (kind === "code")
    out = out.replace(/(^|[\s;{}(),])\/\/[^\n]*/gm, (m, lead: string) => lead + blank(m.slice(lead.length)));
  return out;
}

function lineOf(text: string, index: number): number {
  let n = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** 正規表現(g つき)に合う位置の行番号(重複なし) */
function linesOf(text: string, re: RegExp): number[] {
  const found = new Set<number>();
  for (const m of text.matchAll(new RegExp(re.source, re.flags.includes("g") ? re.flags : `${re.flags}g`))) {
    found.add(lineOf(text, m.index));
  }
  return [...found];
}

interface Block {
  selector: string;
  body: string;
  line: number;
}

/** 入れ子のない `{ … }`(セレクターと宣言の組)を読む。`@media` などの入れ子の外側は、中のブロックで数える。 */
function cssBlocks(clean: string): Block[] {
  const blocks: Block[] = [];
  for (const m of clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const selector = m[1] ?? "";
    const lead = selector.length - selector.trimStart().length;
    blocks.push({ selector: selector.trim(), body: m[2] ?? "", line: lineOf(clean, m.index + lead) });
  }
  return blocks;
}

/** `@keyframes 名前 { … }` の中身と行 */
function keyframes(clean: string): { name: string; body: string; line: number }[] {
  const out: { name: string; body: string; line: number }[] = [];
  for (const m of clean.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
    const open = m.index + m[0].length - 1;
    let depth = 0;
    for (let i = open; i < clean.length; i++) {
      const c = clean[i];
      if (c === "{") depth++;
      if (c === "}" && --depth === 0) {
        out.push({ name: m[1] ?? "", body: clean.slice(open + 1, i), line: lineOf(clean, m.index) });
        break;
      }
    }
  }
  return out;
}

interface Declaration {
  value: string;
  /** 宣言の先頭の行 */
  line: number;
  /** 値の中の位置(0 始まり)の行。複数行の値では、どの行に当たったかを示すために使う */
  lineAt: (offset: number) => number;
}

/** 宣言(`名前: 値;`)の一覧。値は複数行にまたがってよい */
function declarations(clean: string, name: RegExp): Declaration[] {
  const out: Declaration[] = [];
  const re = new RegExp(String.raw`(?<![\w-])(${name.source})\s*:\s*([^;{}]+);`, "g");
  for (const m of clean.matchAll(re)) {
    const valueStart = m.index + m[0].length - (m[2] ?? "").length - 1;
    out.push({
      value: m[2] ?? "",
      line: lineOf(clean, m.index),
      lineAt: (offset) => lineOf(clean, valueStart + offset),
    });
  }
  return out;
}

/** CSS の値の中の長さ(rem・px)を px にして返す */
function lengthsPx(value: string): number[] {
  return [...value.matchAll(/(?<![\w.#-])(-?\d*\.?\d+)(rem|px)\b/g)].map((m) => {
    const n = Number.parseFloat(m[1] ?? "0");
    return m[2] === "rem" ? n * 16 : n;
  });
}

/** カンマで区切る(括弧の中のカンマでは区切らない) */
function splitTop(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let cur = "";
  for (const c of value) {
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (c === "," && depth === 0) {
      parts.push(cur);
      cur = "";
    } else cur += c;
  }
  return [...parts, cur];
}

function stripFunctions(value: string): string {
  let prev = "";
  let out = value;
  while (out !== prev) {
    prev = out;
    out = out.replace(/[\w-]+\([^()]*\)/g, " ");
  }
  return out;
}

/** 光る影(ずれがなく、ぼかしがある影)の行 */
function glowLines(clean: string): number[] {
  const lines: number[] = [];
  for (const { value, line } of declarations(clean, /box-shadow|text-shadow/)) {
    for (const item of splitTop(value)) {
      const nums = stripFunctions(item)
        .split(/\s+/)
        .filter((t) => /^-?\d*\.?\d+(?:px|rem)?$/.test(t))
        .map((t) => Number.parseFloat(t));
      if (nums.length >= 3 && nums[0] === 0 && nums[1] === 0 && (nums[2] ?? 0) > 0) lines.push(line);
    }
  }
  return [...new Set(lines)];
}

/** 行き過ぎて戻るイージングの行(cubic-bezier の y が 0〜1 の外) */
function overshootLines(clean: string): number[] {
  const lines: number[] = [];
  for (const m of clean.matchAll(/cubic-bezier\(\s*([^)]*)\)/g)) {
    const n = (m[1] ?? "").split(",").map((s) => Number.parseFloat(s));
    const y1 = n[1];
    const y2 = n[3];
    if ([y1, y2].some((y) => y !== undefined && !Number.isNaN(y) && (y < 0 || y > 1)))
      lines.push(lineOf(clean, m.index));
  }
  return lines;
}

const LAYOUT_PROPS =
  /(?<![\w-])(?:width|height|min-width|max-width|min-height|max-height|left|right|top|bottom|inset|margin|padding)(?![\w-])/;

/** CSS の宣言の値の中の色の直書き(#rrggbb、rgb()、hsl()、white・black) */
const COLOR_LITERAL =
  /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|rgba|hsl|hsla|oklch|oklab|lab|lch)\(|(?<![\w-])(?:white|black)(?![\w-])/;

function cssColorLines(clean: string): number[] {
  const lines: number[] = [];
  for (const m of clean.matchAll(/(?<![\w-])((?:--)?[a-z-]+)\s*:\s*([^;{}]+);/g)) {
    const name = m[1] ?? "";
    // 色の変数の定義(`--名前: 値`)は、色を集める場所なので数えない
    if (name.startsWith("--")) continue;
    if (COLOR_LITERAL.test(m[2] ?? "")) lines.push(lineOf(clean, m.index));
  }
  return lines;
}

function cssSpacingLines(clean: string): number[] {
  const lines: number[] = [];
  const name =
    /padding(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|margin(?:-(?:top|right|bottom|left|inline|block)(?:-(?:start|end))?)?|gap|row-gap|column-gap/;
  for (const { value, line } of declarations(clean, name)) {
    if (lengthsPx(stripFunctions(value)).some((px) => px !== 0 && px % GRID_PX !== 0)) lines.push(line);
  }
  return lines;
}

const CLASS_START = String.raw`(?<![\w.-])`;
const CLASS_END = String.raw`(?![\w-])`;
const SPACING_UTILITY = "-?(?:p[xytblrse]?|m[xytblrse]?|gap(?:-[xy])?|space-[xy])";

/** 規則ごとの検査。見つかった行番号を返す */
const DETECTORS: Record<RuleId, (p: Prepared) => number[]> = {
  "transition-all": (p) =>
    p.kind === "css"
      ? linesOf(p.clean, /transition(?:-property)?\s*:\s*all\b/)
      : linesOf(p.clean, new RegExp(`${CLASS_START}transition-all${CLASS_END}`)),

  "hover-motion": (p) => {
    if (p.kind === "code") {
      return linesOf(p.clean, new RegExp(`${CLASS_START}(?:group-|peer-)?hover:-?(?:scale|translate|rotate|skew)-`));
    }
    return cssBlocks(p.clean)
      .filter(
        (b) =>
          /:(?:hover|active)\b/.test(b.selector) &&
          /transform\s*:\s*[^;]*\b(?:scale|translate|rotate|skew)/.test(b.body),
      )
      .map((b) => b.line);
  },

  "infinite-animation": (p) =>
    p.kind === "css"
      ? declarations(p.clean, /animation|animation-iteration-count/).flatMap((d) => {
          const at = d.value.search(/\binfinite\b/);
          return at < 0 ? [] : [d.lineAt(at)];
        })
      : linesOf(p.clean, new RegExp(`${CLASS_START}animate-(?:pulse|ping|bounce|spin)${CLASS_END}`)),

  "overshoot-easing": (p) => overshootLines(p.clean),

  "layout-motion": (p) => {
    if (p.kind === "code") {
      return linesOf(
        p.clean,
        new RegExp(`${CLASS_START}transition-\\[[^\\]]*(?:width|height|left|right|top|bottom|margin|padding|inset)`),
      );
    }
    const transitions = declarations(p.clean, /transition|transition-property/).flatMap((d) => {
      const at = d.value.replace(/var\([^)]*\)/g, (v) => " ".repeat(v.length)).search(LAYOUT_PROPS);
      return at < 0 ? [] : [d.lineAt(at)];
    });
    const frames = keyframes(p.clean)
      .filter((k) => new RegExp(`${LAYOUT_PROPS.source}\\s*:`).test(k.body))
      .map((k) => k.line);
    return [...transitions, ...frames];
  },

  "heavy-weight": (p) =>
    p.kind === "css"
      ? linesOf(p.clean, /font-weight\s*:\s*(?:800|900|bolder)\b/)
      : linesOf(p.clean, new RegExp(`${CLASS_START}font-(?:black|extrabold)${CLASS_END}`)),

  "weight-steps": (p) =>
    p.kind === "css"
      ? linesOf(p.clean, /font-weight\s*:\s*(?:[1-3]00|500|600|lighter)\b/)
      : linesOf(p.clean, new RegExp(`${CLASS_START}font-(?:thin|extralight|light|medium|semibold)${CLASS_END}`)),

  italic: (p) =>
    p.kind === "css"
      ? linesOf(p.clean, /font-style\s*:\s*(?:italic|oblique)/)
      : linesOf(p.clean, new RegExp(`${CLASS_START}italic${CLASS_END}|<(?:em|i)[\\s>/]`)),

  "case-tracking": (p) =>
    p.kind === "css"
      ? linesOf(p.clean, /text-transform\s*:\s*(?:uppercase|lowercase|capitalize)|letter-spacing\s*:/)
      : linesOf(
          p.clean,
          new RegExp(
            `${CLASS_START}(?:uppercase|lowercase|capitalize)${CLASS_END}|${CLASS_START}tracking-(?!normal${CLASS_END})[\\w-]+`,
          ),
        ),

  "fullwidth-exclamation": (p) => linesOf(p.clean, /！/),

  gradient: (p) =>
    p.kind === "css"
      ? linesOf(p.clean, /(?:repeating-)?(?:linear|radial|conic)-gradient\(/)
      : linesOf(
          p.clean,
          new RegExp(
            `${CLASS_START}bg-(?:gradient|linear|radial|conic)-|${CLASS_START}bg-clip-text${CLASS_END}|(?:linear|radial|conic)-gradient\\(`,
          ),
        ),

  "glow-shadow": (p) =>
    p.kind === "css"
      ? glowLines(p.clean)
      : linesOf(
          p.clean,
          new RegExp(`${CLASS_START}shadow-\\[|${CLASS_START}drop-shadow|${CLASS_START}blur(?:-[\\w[]+)?(?![\\w(-])`),
        ),

  "odd-spacing": (p) =>
    p.kind === "css"
      ? cssSpacingLines(p.clean)
      : linesOf(p.clean, new RegExp(`${CLASS_START}${SPACING_UTILITY}-(?:[1-9]\\d*\\.5(?![\\d.])|\\[)`)),

  "waiting-message": (p) => linesOf(p.clean, /ここに[^。」"'`<>{}]{0,40}(?:表示|出ます|並びます|載ります|現れます)/),

  "badge-words": (p) => linesOf(p.clean, /(?<![A-Za-z_])(?:NEW|HOT)(?![A-Za-z_])|おすすめ|人気|新着|イチオシ/),

  emoji: (p) => {
    const found: number[] = [];
    p.clean.split("\n").forEach((l, i) => {
      if (/\p{Extended_Pictographic}/u.test(l.replace(MARKS, ""))) found.push(i + 1);
    });
    return found;
  },

  "rounded-full": (p) =>
    p.kind === "css"
      ? linesOf(p.clean, /border-radius\s*:[^;]*9999px/)
      : linesOf(p.clean, new RegExp(`${CLASS_START}rounded-full${CLASS_END}`)),

  "border-l-thick": (p) =>
    p.kind === "css"
      ? linesOf(p.clean, /border-left\s*:\s*[2-9]\d*px/)
      : linesOf(p.clean, new RegExp(`${CLASS_START}border-l-(?:[2-9]|\\[)`)),

  "hardcoded-color": (p) =>
    p.kind === "css"
      ? cssColorLines(p.clean)
      : linesOf(
          p.clean,
          new RegExp(
            [
              `${CLASS_START}(?:bg|text|border|fill|stroke|ring|outline|from|via|to|decoration|divide)-(?:white|black)(?![\\w])`,
              `${CLASS_START}(?:bg|text|border|fill|stroke|ring|outline|from|via|to|decoration|divide)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\\d{2,3}(?![\\w])`,
              `["'\`]#[0-9a-fA-F]{3,8}["'\`]`,
              `\\b(?:rgb|rgba|hsl|hsla|oklch)\\(`,
            ].join("|"),
          ),
        ),

  "body-line-height": (p) => {
    if (p.kind !== "css") return [];
    const bodies = cssBlocks(p.clean).filter((b) => b.selector === "body");
    const heights = bodies.flatMap((b) =>
      declarations(b.body, /line-height/).map((d) => ({ value: Number(d.value.trim()), line: b.line })),
    );
    const bad = heights.filter((h) => !(h.value >= LINE_HEIGHT_MIN && h.value <= LINE_HEIGHT_MAX)).map((h) => h.line);
    // 本文の規則は、グローバルの CSS が持つ(`body` に行間がなければ、1 行目で報告する)
    if (/(?:^|\/)globals\.css$/.test(p.file) && heights.length === 0) return [1];
    return bad;
  },

  "heading-note": (p) => {
    if (p.kind !== "code") return [];
    const found = new Set<number>();
    for (const m of p.clean.matchAll(/<\/h[1-6]>\s*<(?:p|span|div)\b[^>]*?className=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      const classes = m[1] ?? m[2] ?? "";
      if (/(?<![\w-])text-xs(?![\w-])/.test(classes) && /(?<![\w-])text-muted(?![\w-])/.test(classes)) {
        found.add(lineOf(p.clean, m.index));
      }
    }
    return [...found];
  },
};

const APP = "packages/app/src";
const CSS = `${APP}/app/globals.css`;

/** 分野の色(同じ分野には、すべての画面で同じ色)を、カードや行の左の線で示す */
const DOMAIN_LINE =
  "分野の見分け。同じ分野には、すべての画面で同じ色を使い、分野の名前の文字も添える(分野の色の決まり)";
/** 進み具合・割合のバー(溝と塗り)。端を丸めるのは、バーの形 */
const BAR = "進み具合・割合のバー(溝と塗り)の形。錠剤形にするのはバーだけで、ボタンやカードは丸めない";
/** 押した状態を持つ切り替えのチップ */
const TOGGLE_CHIP =
  "押した状態(aria-pressed)を持つ切り替えのチップ。ボタンやカードではなく、絞り込みや印の切り替えだけに使う";

/**
 * 意図して残す箇所の一覧。各項目に理由を書く(理由の全体は docs/app/design-tone.md の「意図して残す型」)。
 * 件数が実際と違うと、検査が止まる(足したときも、消したときも、一覧を直す)。
 */
export const ALLOWED: Allow[] = [
  // ---- 絵文字: 種類の見分けに使う飾り。同じ種類には同じ絵文字を使い、aria-hidden で読み上げず、意味は文字でも伝える ----
  {
    rule: "emoji",
    file: `${APP}/components/mode-select.tsx`,
    count: 10,
    reason: "モードの見分けのタイル(.tile)。モードの名前と説明の文字が意味を伝え、絵文字は見分けの手がかりにとどめる",
  },
  {
    rule: "emoji",
    file: `${APP}/components/explanation-view.tsx`,
    count: 7,
    reason:
      "解説の見出しの種類(要件・正解・知識・考え方・要約・誤り・その他)の見分け。見出しの文字と色でも伝え、シンプル表示では出さない",
  },
  {
    rule: "emoji",
    file: `${APP}/app/exams/[code]/study/[unit]/page.tsx`,
    count: 5,
    reason: "教科書のパート(学ぶこと・本文・図・ポイント・出典)の見分け。見出しの文字でも伝える(StudyCard)",
  },
  {
    rule: "emoji",
    file: `${APP}/components/unit-summary.tsx`,
    count: 1,
    reason: "教科書のパート「この単元の要点」の見分け。ほかのパートと同じ扱い(StudyCard)",
  },

  // ---- カードの 1 辺だけの太い色線: 意味(分野・正誤・状態・種類)を持つもの。飾りとしての使用は置かない ----
  { rule: "border-l-thick", file: `${APP}/app/exams/[code]/study/page.tsx`, count: 1, reason: DOMAIN_LINE },
  {
    rule: "border-l-thick",
    file: `${APP}/app/exams/[code]/study/domains/[domain]/page.tsx`,
    count: 1,
    reason: DOMAIN_LINE,
  },
  { rule: "border-l-thick", file: `${APP}/components/code-drill-list.tsx`, count: 1, reason: DOMAIN_LINE },
  { rule: "border-l-thick", file: `${APP}/components/dashboard-view.tsx`, count: 1, reason: DOMAIN_LINE },
  { rule: "border-l-thick", file: `${APP}/components/domain-menu.tsx`, count: 1, reason: DOMAIN_LINE },
  { rule: "border-l-thick", file: `${APP}/components/mode-select.tsx`, count: 1, reason: DOMAIN_LINE },
  {
    rule: "border-l-thick",
    file: `${APP}/components/notebook-view.tsx`,
    count: 1,
    match: "color?.border",
    reason: DOMAIN_LINE,
  },
  {
    rule: "border-l-thick",
    file: `${APP}/components/notebook-view.tsx`,
    count: 1,
    match: "border-warn",
    reason: "「ここを押さえる」の注意の囲み。注意の色の面と枠に、見出しの文字を添える(注意の意味を持つ囲み)",
  },
  {
    rule: "border-l-thick",
    file: `${APP}/components/code-drill-player.tsx`,
    count: 3,
    match: "border-warn",
    reason: "「実行するとどうなるか」などの注意の囲み。注意の色の面に、見出しの文字(種類)を添える",
  },
  {
    rule: "border-l-thick",
    file: `${APP}/components/code-drill-player.tsx`,
    count: 1,
    match: "font-bold",
    reason: "正誤の帯。正解・不正解の色の面に、「○ 正解です」「× 不正解です」の文字を添える(色だけに頼らない)",
  },
  {
    rule: "border-l-thick",
    file: `${APP}/components/notebook-check.tsx`,
    count: 1,
    reason: "正誤の帯。正解・不正解の色の面に、「○ 正解です」「× 不正解です」の文字を添える(色だけに頼らない)",
  },
  {
    rule: "border-l-thick",
    file: `${APP}/components/player.tsx`,
    count: 1,
    reason: "正誤の帯。正解・不正解の色の面に、「○ 正解です」「× 不正解です」の文字を添える(色だけに頼らない)",
  },
  {
    rule: "border-l-thick",
    file: `${APP}/components/unit-practice.tsx`,
    count: 1,
    reason: "正誤の帯。正解・不正解の色の面に、「○ 正解です」「× 不正解です」の文字を添える(色だけに頼らない)",
  },
  {
    rule: "border-l-thick",
    file: `${APP}/components/result-view.tsx`,
    count: 1,
    reason: "問題ごとの正誤の色。「正解」「不正解」の文字と記号でも伝える(色だけに頼らない)",
  },
  {
    rule: "border-l-thick",
    file: `${APP}/components/prediction-card.tsx`,
    count: 1,
    reason: "合格ラインへの到達・未達の色。「合格ライン到達」「あと n ポイント」の文字でも伝える(色だけに頼らない)",
  },
  {
    rule: "border-l-thick",
    file: `${APP}/components/notice.tsx`,
    count: 1,
    reason: "通知の種類(エラー・完了・お知らせ)の色。記号(!・✓・i)と読み上げ用の種類の名前でも伝える(Notice)",
  },
  {
    rule: "border-l-thick",
    file: `${APP}/components/study-card.tsx`,
    count: 1,
    reason: "教科書のパート(学ぶこと・本文・図・要点・ポイント・出典)の見分け。見出しの文字でも伝える(StudyCard)",
  },
  {
    rule: "border-l-thick",
    file: `${APP}/components/summary-cards.tsx`,
    count: 3,
    reason:
      "要約カードの役割(問い・答え・決め手)の見分け。答えの欄は、開閉の状態も色で示す。見出しと「正解」の文字でも伝える",
  },
  {
    rule: "border-l-thick",
    file: CSS,
    count: 1,
    match: "var(--tone",
    reason: "解説のカード(.exp-card)の種類の色。見出しの文字でも伝える。シンプル表示では、枠と面をやめて線だけにする",
  },
  {
    rule: "border-l-thick",
    file: CSS,
    count: 1,
    match: "var(--border)",
    reason: "シンプル表示の解説。枠と面をやめた代わりに、補助の色の細い線で、まとまりを示す",
  },

  // ---- 丸い錠剤形: バー・円・ラベル・押した状態を持つチップに限る(ボタンとカードは丸めない) ----
  { rule: "rounded-full", file: `${APP}/components/resume-cards.tsx`, count: 2, reason: BAR },
  { rule: "rounded-full", file: `${APP}/components/summary-cards.tsx`, count: 2, reason: BAR },
  { rule: "rounded-full", file: `${APP}/components/unit-practice.tsx`, count: 2, reason: BAR },
  { rule: "rounded-full", file: `${APP}/components/domain-bars.tsx`, count: 2, reason: BAR },
  { rule: "rounded-full", file: `${APP}/components/notebook-view.tsx`, count: 1, reason: BAR },
  { rule: "rounded-full", file: `${APP}/components/player.tsx`, count: 2, match: "rounded-full bg-", reason: BAR },
  {
    rule: "rounded-full",
    file: `${APP}/components/player.tsx`,
    count: 2,
    match: "rounded-full border",
    reason: TOGGLE_CHIP,
  },
  { rule: "rounded-full", file: `${APP}/components/bookmark-toggle.tsx`, count: 1, reason: TOGGLE_CHIP },
  { rule: "rounded-full", file: `${APP}/components/question-preview.tsx`, count: 1, reason: TOGGLE_CHIP },
  {
    rule: "rounded-full",
    file: `${APP}/components/diagram.tsx`,
    count: 2,
    reason: "切り替えのスイッチ(role=switch)の溝と、動く丸。スイッチの形",
  },
  {
    rule: "rounded-full",
    file: `${APP}/components/notice.tsx`,
    count: 1,
    reason: "通知の種類を示す記号(!・✓・i)の円。番号ではなく、種類の記号",
  },
  {
    rule: "rounded-full",
    file: `${APP}/components/page-skeletons.tsx`,
    count: 3,
    reason: "読み込み中の骨組み。円のゲージとバーの形に合わせる",
  },
  {
    rule: "rounded-full",
    file: CSS,
    count: 7,
    match: "border-radius: 9999px",
    reason:
      "ラベル(.chip)、選択肢の記号の円(.choice-chip)、残り時間(.timer-pill)、見直しと未読の点、読み込み中のバッジとスピナー。ラベル・点・円に限り、ボタンとカードには使わない",
  },
  {
    rule: "rounded-full",
    file: CSS,
    count: 1,
    match: "0 9999px 9999px 0",
    reason: BAR,
  },

  // ---- 動き: 待っていること、操作の結果を伝える意味のある動き ----
  {
    rule: "infinite-animation",
    file: CSS,
    count: 1,
    match: "skeleton-shine",
    reason: "スケルトンの光。画面を読み込んでいる間だけ、待っていることを伝える(読み込みが終われば消える)",
  },
  {
    rule: "infinite-animation",
    file: CSS,
    count: 2,
    match: "animation: spin",
    reason: "スピナー。待っていることを伝える。動きを減らす設定では回さず、文言を添える",
  },
  {
    rule: "layout-motion",
    file: CSS,
    count: 1,
    match: "transition: width",
    reason: "進み具合のバーが伸びる(.motion-bar)。値の変化を伝える。シンプルと動きを減らす設定では止める",
  },
  {
    rule: "layout-motion",
    file: CSS,
    count: 1,
    match: "@keyframes nav-progress-grow",
    reason:
      "遷移中のバー。待っていることを、幅が伸びて伝える。単色で、光らせず、動きを減らす設定では途中の長さで止める",
  },
  {
    rule: "layout-motion",
    file: CSS,
    count: 1,
    match: "height 0.2s",
    reason:
      "サイドバーの選択中の背景が、項目の間を滑る(.nav-indicator)。操作の結果を示す。シンプルと動きを減らす設定では止める",
  },
  {
    rule: "layout-motion",
    file: CSS,
    count: 1,
    match: "left 0.2s",
    reason: "操作で動く図のスイッチの丸が移る(.motion-lit)。操作の結果を示す。シンプルと動きを減らす設定では止める",
  },

  // ---- グラデーション: 色の変化を作らないもの ----
  {
    rule: "gradient",
    file: CSS,
    count: 1,
    match: "linear-gradient(transparent",
    reason: "体系ノートの要点のマーカー。面の下の部分だけを塗るペンの形で、色の変化は作らない",
  },
  {
    rule: "gradient",
    file: CSS,
    count: 1,
    match: "linear-gradient(",
    reason: "スケルトンの光(.skeleton)。待っていることを伝える動きの光の筋で、面の装飾には使わない",
  },

  // ---- 色の直書き: CSS の変数を読めない場所と、テーマによらない幕 ----
  {
    rule: "hardcoded-color",
    file: `${APP}/components/site-nav.tsx`,
    count: 1,
    reason: "メニューのシートの背後の幕。ライトでもダークでも、下の画面を暗くするため、テーマによらず黒の半透明にする",
  },
  {
    rule: "hardcoded-color",
    file: `${APP}/components/notebook-shell.tsx`,
    count: 1,
    reason: "目次の背後の幕。ライトでもダークでも、下の画面を暗くするため、テーマによらず黒の半透明にする",
  },
  {
    rule: "hardcoded-color",
    file: `${APP}/lib/pwa.ts`,
    count: 2,
    reason:
      "ブラウザのバーの色(`themeColor`。ページの背景と一致することを palette.test.ts が確かめる)と、ホーム画面に追加したときの起動画面の背景色。メタデータとマニフェストは、CSS の変数を読めない",
  },

  // ---- そのほか ----
  {
    rule: "case-tracking",
    file: `${APP}/components/diagram.tsx`,
    count: 1,
    reason: "データの流れの図の粒の記号(●)の間隔。英字のラベルの飾りではない",
  },
  {
    rule: "fullwidth-exclamation",
    file: `${APP}/lib/diagram-layout.ts`,
    count: 1,
    reason: "図の文字を折り返すときの、行頭に置かない文字の集合(禁則処理)。画面の文言ではない",
  },
];

function kindOf(file: string): Kind | null {
  if (/\.css$/.test(file)) return "css";
  if (/\.(?:ts|tsx)$/.test(file)) return "code";
  return null;
}

/** 検査の対象のファイル(アプリの画面の部品と CSS。テスト・型定義・テスト用の設定は除く) */
export function isTarget(file: string): boolean {
  if (!file.startsWith("packages/app/src/")) return false;
  if (kindOf(file) === null) return false;
  if (/\.(?:test|spec)\.tsx?$/.test(file) || /\.d\.ts$/.test(file)) return false;
  if (file.startsWith("packages/app/src/test/")) return false;
  return true;
}

/** 許可の前の、すべての指摘 */
export function findAll(sources: Source[]): Finding[] {
  const findings: Finding[] = [];
  for (const { file, text } of sources) {
    const kind = kindOf(file);
    if (kind === null) continue;
    const prepared: Prepared = { file, kind, clean: stripComments(text, kind), lines: text.split("\n") };
    for (const rule of RULES) {
      for (const line of DETECTORS[rule](prepared)) {
        findings.push({ rule, file, line, text: (prepared.lines[line - 1] ?? "").trim() });
      }
    }
  }
  return findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.rule.localeCompare(b.rule));
}

export interface CheckResult {
  /** 許可がなく、直すべき指摘 */
  errors: string[];
  /** 許可した指摘の数 */
  allowed: number;
}

/** 許可の一覧自体の誤り(理由が空、規則の名前が違う、同じ組の重複)。 */
export function checkAllowList(allowed: Allow[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  allowed.forEach((a, i) => {
    const where = `許可の一覧の ${i + 1} 件目(${a.file})`;
    if (!(RULES as readonly string[]).includes(a.rule)) errors.push(`${where}: 規則の名前が違う`);
    if (a.reason.trim() === "") errors.push(`${where}: 理由が空`);
    if (!Number.isInteger(a.count) || a.count < 1) errors.push(`${where}: 件数が 1 以上の整数でない`);
    const key = `${a.rule}\0${a.file}\0${a.match ?? ""}`;
    if (seen.has(key)) errors.push(`${where}: 同じ規則・ファイル・照合の組が重複している`);
    seen.add(key);
  });
  return errors;
}

/** 指摘と許可の一覧を突き合わせる。許可のない指摘と、件数の合わない許可を、エラーにする。 */
export function checkUiPatterns(sources: Source[], allowed: Allow[] = ALLOWED): CheckResult {
  const errors = checkAllowList(allowed);
  const findings = findAll(sources);
  const used = new Set<Finding>();
  let allowedCount = 0;
  for (const a of allowed) {
    const hits = findings.filter(
      (f) =>
        f.rule === a.rule && f.file === a.file && !used.has(f) && (a.match === undefined || f.text.includes(a.match)),
    );
    for (const f of hits.slice(0, a.count)) {
      used.add(f);
      allowedCount++;
    }
    if (hits.length !== a.count) {
      errors.push(
        `${a.file}: 許可の一覧(${RULE_LABELS[a.rule] ?? a.rule})の件数が合わない(一覧は ${a.count} 件、実際は ${hits.length} 件)`,
      );
    }
  }
  for (const f of findings) {
    if (!used.has(f)) errors.push(`${f.file}:${f.line}: ${RULE_LABELS[f.rule]}`);
  }
  return { errors, allowed: allowedCount };
}
