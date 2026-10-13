import { containsUrl } from "../contract.ts";
import { compact } from "../text.ts";
import type { ChoiceDraft } from "./schema.ts";
import { similarity } from "./similarity.ts";

/**
 * 作問のスタイル規則。設問文と選択肢の作り方を、機械で検査できる形で持つ(docs/question-style.md)。
 * 規則は、名前・重さ(止める / 警告)・検査の関数を持つ。報告は、規則の名前と場所(項目)だけで、本文を引用しない。
 */

/** 規則の集合を変えたら上げる。下書きの依頼の鍵に入るので、上げると依頼のキャッシュが切れる */
export const STYLE_VERSION = 1;

export type Severity = "block" | "warn";

export interface Finding {
  rule: string;
  severity: Severity;
  /** 場所。questionText、choices.2.text、explanation など */
  path: string;
}

export interface StyleRule {
  name: string;
  severity: Severity;
  /** 規則の説明(エージェントへの依頼に載せる) */
  summary: string;
  /** 違反した場所の一覧。通れば空 */
  check(draft: ChoiceDraft): string[];
}

/** 検査する本文と、その場所 */
function texts(draft: ChoiceDraft): { path: string; text: string }[] {
  return [
    { path: "questionText", text: draft.questionText },
    ...draft.choices.flatMap((c, i) => [
      { path: `choices.${i}.text`, text: c.text },
      ...(c.explanation !== undefined ? [{ path: `choices.${i}.explanation`, text: c.explanation }] : []),
    ]),
    { path: "explanation", text: draft.explanation },
    ...(draft.supplement !== undefined ? [{ path: "supplement", text: draft.supplement }] : []),
  ];
}

const length = (text: string) => compact(text).length;
const average = (values: number[]) => values.reduce((a, b) => a + b, 0) / values.length;

// ---- 設問文 ----

/** 問いの形で終わる: 疑問・指示の語尾か、疑問符 */
const QUESTION_ENDING = /(か|ください|なさい|選べ|答えよ|[?？])[。.!！]*$/;

/** 否定の表現。長い語を先に並べ、重なって数えないようにする */
const NEGATION = /適切でない|不適切|誤っている|含まれない|ではない|できない|以外|でない/g;

const KANJI_NUMBERS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const COUNT_PHRASE = /([0-9０-９]+|[一二三四五六七八九十])\s*(?:つ|個|件|項目)/;

/** 設問文に書かれた「選ぶ数」。書かれていなければ null */
function statedCount(stem: string): number | null {
  const m = COUNT_PHRASE.exec(stem.normalize("NFKC"));
  if (m === null) return null;
  const raw = m[1] as string;
  return KANJI_NUMBERS[raw] ?? Number(raw);
}

// ---- 選択肢 ----

/** 「すべて」「いずれでもない」のような、選択肢をまとめる選択肢 */
const CATCH_ALL =
  /^(すべて|全て|いずれも|どれも)(が|は)?(正しい|該当|当てはまる|誤り|間違い|適切)|いずれでもない|どれでもない|上記のすべて|上記すべて|上記のいずれも|上記のどれも|^なし$|none of the above|all of the above/i;

/** 断定しすぎる語 */
const OVERCLAIM = /必ず|絶対|決して|常に|100\s*%|完全に|唯一|あらゆる|一切/;

/** 環境固有の値の形: 12 桁の数字(アカウント ID)、ARN、アクセスキー ID、メールアドレス、ローカルのパス */
const ENV_VALUE = [
  /(?<![0-9])[0-9]{12}(?![0-9])/,
  /arn:aws[a-z-]*:/i,
  /\bAKIA[0-9A-Z]{16}\b/,
  /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/,
  /\/Users\/|\/home\/[a-z]|[A-Za-z]:\\/,
];

/** 環境固有の値の形を含むか */
export function hasEnvValue(text: string): boolean {
  return ENV_VALUE.some((re) => re.test(text));
}

export const STYLE_RULES: readonly StyleRule[] = [
  {
    name: "stem-question-form",
    severity: "block",
    summary: "設問文は、問いの形(「〜か。」「〜してください。」など)で終える",
    check: (d) => (QUESTION_ENDING.test(d.questionText.normalize("NFKC").trim()) ? [] : ["questionText"]),
  },
  {
    name: "multi-select-count",
    severity: "block",
    summary: "複数選択の設問文には、選ぶ数(「2 つ選択」など)を書く",
    check: (d) => (d.questionType === "multiple" && statedCount(d.questionText) === null ? ["questionText"] : []),
  },
  {
    name: "multi-select-count-mismatch",
    severity: "block",
    summary: "複数選択の設問文に書いた数は、正答の数と一致させる",
    check: (d) => {
      if (d.questionType !== "multiple") return [];
      const n = statedCount(d.questionText);
      return n !== null && n !== d.correctAnswers.length ? ["questionText"] : [];
    },
  },
  {
    name: "stem-negation",
    severity: "warn",
    summary: "否定を含む設問は避ける。使うなら否定の語を 1 つだけにし、強調する",
    check: (d) => ((d.questionText.normalize("NFKC").match(NEGATION) ?? []).length >= 1 ? ["questionText"] : []),
  },
  {
    name: "stem-double-negation",
    severity: "block",
    summary: "設問文に否定の表現を 2 つ以上入れない(二重否定)",
    check: (d) => ((d.questionText.normalize("NFKC").match(NEGATION) ?? []).length >= 2 ? ["questionText"] : []),
  },
  {
    name: "choice-count",
    severity: "warn",
    summary: "選択肢は 4 つ以上にする",
    check: (d) => (d.choices.length < 4 ? ["choices"] : []),
  },
  {
    name: "choice-length-balance",
    severity: "warn",
    summary: "選択肢の長さをそろえる(最も長いものが最も短いものの 3 倍を超えない)",
    check: (d) => {
      const lengths = d.choices.map((c) => length(c.text));
      const min = Math.min(...lengths);
      const max = Math.max(...lengths);
      return min >= 1 && max >= 30 && max / min > 3 ? ["choices"] : [];
    },
  },
  {
    name: "correct-length-bias",
    severity: "warn",
    summary: "正答だけが長い(短い)といった偏りを作らない",
    check: (d) => {
      const correct = d.choices.filter((c) => d.correctAnswers.includes(c.key));
      const wrong = d.choices.filter((c) => !d.correctAnswers.includes(c.key));
      if (correct.length === 0 || wrong.length === 0) return [];
      const c = average(correct.map((x) => length(x.text)));
      const w = average(wrong.map((x) => length(x.text)));
      return (c >= 20 && c > w * 1.5) || (w >= 20 && c < w * 0.5) ? ["choices"] : [];
    },
  },
  {
    name: "choice-similar-pair",
    severity: "warn",
    summary: "ほぼ同じ文言の選択肢を並べない(紛らわしさは、内容の違いで作る)",
    check: (d) =>
      d.choices.flatMap((c, i) =>
        d.choices.slice(0, i).some((p) => similarity(p.text, c.text) >= 0.85) ? [`choices.${i}.text`] : [],
      ),
  },
  {
    name: "choice-catch-all",
    severity: "block",
    summary: "「すべて正しい」「いずれでもない」のような、選択肢をまとめる選択肢を置かない",
    check: (d) =>
      d.choices.flatMap((c, i) => (CATCH_ALL.test(c.text.normalize("NFKC").trim()) ? [`choices.${i}.text`] : [])),
  },
  {
    name: "overclaim-term",
    severity: "warn",
    summary: "「必ず」「絶対」「常に」など、断定しすぎる語を設問文・選択肢・解説に使わない",
    check: (d) => texts(d).flatMap((t) => (OVERCLAIM.test(t.text.normalize("NFKC")) ? [t.path] : [])),
  },
  {
    name: "explanation-length",
    severity: "warn",
    summary: "総合解説は、正答の理由が分かる長さ(30 文字以上)で書く",
    check: (d) => (length(d.explanation) < 30 ? ["explanation"] : []),
  },
  {
    name: "no-url",
    severity: "block",
    summary: "設問文・選択肢・解説に URL を書かない(出典は別に記録する)",
    check: (d) => texts(d).flatMap((t) => (containsUrl(t.text) ? [t.path] : [])),
  },
  {
    name: "no-env-value",
    severity: "block",
    summary: "環境固有の値(12 桁のアカウント ID、ARN、アクセスキー、メールアドレス、ローカルのパス)を書かない",
    check: (d) => texts(d).flatMap((t) => (hasEnvValue(t.text) ? [t.path] : [])),
  },
];

/** 下書きにスタイル規則を適用する。結果は、規則の名前・重さ・場所だけ(本文は含まない) */
export function checkStyle(draft: ChoiceDraft, rules: readonly StyleRule[] = STYLE_RULES): Finding[] {
  return rules.flatMap((rule) =>
    rule.check(draft).map((path): Finding => ({ rule: rule.name, severity: rule.severity, path })),
  );
}

export interface StyleVerdict {
  /** 止める規則の違反。1 件でもあれば、下書きは先へ進めない */
  blockers: Finding[];
  /** 警告の規則の違反。報告するだけで、先へは進められる */
  warnings: Finding[];
}

export function evaluateStyle(draft: ChoiceDraft, rules: readonly StyleRule[] = STYLE_RULES): StyleVerdict {
  const all = checkStyle(draft, rules);
  return {
    blockers: all.filter((f) => f.severity === "block"),
    warnings: all.filter((f) => f.severity === "warn"),
  };
}
