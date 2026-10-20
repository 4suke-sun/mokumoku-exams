import { containsUrl, HEADING_KINDS, normalizeHeading } from "../contract.ts";
import { compact } from "../text.ts";
import { type ChoiceDraft, type Draft, isChoiceDraft } from "./schema.ts";
import { similarity } from "./similarity.ts";

/**
 * 作問のスタイル規則。設問文と選択肢の作り方を、機械で検査できる形で持つ(docs/question-style.md)。
 * 規則は、名前・重さ(止める / 警告)・検査の関数を持つ。報告は、規則の名前と場所(項目)だけで、本文を引用しない。
 */

/** 規則の集合を変えたら上げる。下書きの依頼の鍵に入るので、上げると依頼のキャッシュが切れる */
export const STYLE_VERSION = 3;

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
  /** どの種別の下書きに適用するか。選択式(単一・複数)、自由記述、どちらにも */
  appliesTo: "choice" | "free-text" | "both";
  /** 違反した場所の一覧。通れば空 */
  check(draft: Draft): string[];
}

/** 選択式の下書きにだけ適用する規則の検査を、種別で絞って呼ぶ */
function onChoice(check: (draft: ChoiceDraft) => string[]): (draft: Draft) => string[] {
  return (draft) => (isChoiceDraft(draft) ? check(draft) : []);
}

/** 検査する本文と、その場所 */
function texts(draft: Draft): { path: string; text: string }[] {
  const body = isChoiceDraft(draft)
    ? draft.choices.flatMap((c, i) => [
        { path: `choices.${i}.text`, text: c.text },
        ...(c.explanation !== undefined ? [{ path: `choices.${i}.explanation`, text: c.explanation }] : []),
      ])
    : draft.rubric.criteria.flatMap((c, i) => [
        { path: `rubric.criteria.${i}.name`, text: c.name },
        ...c.keywords.map((k, j) => ({ path: `rubric.criteria.${i}.keywords.${j}`, text: k })),
      ]);
  return [
    { path: "questionText", text: draft.questionText },
    ...body,
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
export const NEGATION = /適切でない|不適切|誤っている|含まれない|ではない|できない|以外|でない/g;

const KANJI_NUMBERS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 十: 10 };
const COUNT_PHRASE = /([0-9０-９]+|[一二三四五六七八九十])\s*(?:つ|個|件|項目)/;

/** 設問文に書かれた「選ぶ数」。書かれていなければ null */
export function statedCount(stem: string): number | null {
  const m = COUNT_PHRASE.exec(stem.normalize("NFKC"));
  if (m === null) return null;
  const raw = m[1] as string;
  return KANJI_NUMBERS[raw] ?? Number(raw);
}

// ---- 選択肢 ----

/** 「すべて」「いずれでもない」のような、選択肢をまとめる選択肢 */
export const CATCH_ALL =
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
    appliesTo: "both",
    severity: "block",
    summary: "設問文は、問いの形(「〜か。」「〜してください。」など)で終える",
    check: (d) => (QUESTION_ENDING.test(d.questionText.normalize("NFKC").trim()) ? [] : ["questionText"]),
  },
  {
    name: "multi-select-count",
    appliesTo: "choice",
    severity: "block",
    summary: "複数選択の設問文には、選ぶ数(「2 つ選択」など)を書く",
    check: onChoice((d) =>
      d.questionType === "multiple" && statedCount(d.questionText) === null ? ["questionText"] : [],
    ),
  },
  {
    name: "multi-select-count-mismatch",
    appliesTo: "choice",
    severity: "block",
    summary: "複数選択の設問文に書いた数は、正答の数と一致させる",
    check: onChoice((d) => {
      if (d.questionType !== "multiple") return [];
      const n = statedCount(d.questionText);
      return n !== null && n !== d.correctAnswers.length ? ["questionText"] : [];
    }),
  },
  {
    name: "stem-negation",
    appliesTo: "both",
    severity: "warn",
    summary: "否定を含む設問は避ける。使うなら否定の語を 1 つだけにし、強調する",
    check: (d) => ((d.questionText.normalize("NFKC").match(NEGATION) ?? []).length >= 1 ? ["questionText"] : []),
  },
  {
    name: "stem-double-negation",
    appliesTo: "both",
    severity: "block",
    summary: "設問文に否定の表現を 2 つ以上入れない(二重否定)",
    check: (d) => ((d.questionText.normalize("NFKC").match(NEGATION) ?? []).length >= 2 ? ["questionText"] : []),
  },
  {
    name: "choice-count",
    appliesTo: "choice",
    severity: "warn",
    summary: "選択肢は 4 つ以上にする",
    check: onChoice((d) => (d.choices.length < 4 ? ["choices"] : [])),
  },
  {
    name: "choice-length-balance",
    appliesTo: "choice",
    severity: "warn",
    summary: "選択肢の長さをそろえる(最も長いものが最も短いものの 3 倍を超えない)",
    check: onChoice((d) => {
      const lengths = d.choices.map((c) => length(c.text));
      const min = Math.min(...lengths);
      const max = Math.max(...lengths);
      return min >= 1 && max >= 30 && max / min > 3 ? ["choices"] : [];
    }),
  },
  {
    name: "correct-length-bias",
    appliesTo: "choice",
    severity: "warn",
    summary: "正答だけが長い(短い)といった偏りを作らない",
    check: onChoice((d) => {
      const correct = d.choices.filter((c) => d.correctAnswers.includes(c.key));
      const wrong = d.choices.filter((c) => !d.correctAnswers.includes(c.key));
      if (correct.length === 0 || wrong.length === 0) return [];
      const c = average(correct.map((x) => length(x.text)));
      const w = average(wrong.map((x) => length(x.text)));
      return (c >= 20 && c > w * 1.5) || (w >= 20 && c < w * 0.5) ? ["choices"] : [];
    }),
  },
  {
    name: "choice-similar-pair",
    appliesTo: "choice",
    severity: "warn",
    summary: "ほぼ同じ文言の選択肢を並べない(紛らわしさは、内容の違いで作る)",
    check: onChoice((d) =>
      d.choices.flatMap((c, i) =>
        d.choices.slice(0, i).some((p) => similarity(p.text, c.text) >= 0.85) ? [`choices.${i}.text`] : [],
      ),
    ),
  },
  {
    name: "choice-catch-all",
    appliesTo: "choice",
    severity: "block",
    summary: "「すべて正しい」「いずれでもない」のような、選択肢をまとめる選択肢を置かない",
    check: onChoice((d) =>
      d.choices.flatMap((c, i) => (CATCH_ALL.test(c.text.normalize("NFKC").trim()) ? [`choices.${i}.text`] : [])),
    ),
  },
  {
    name: "overclaim-term",
    appliesTo: "both",
    severity: "warn",
    summary: "「必ず」「絶対」「常に」など、断定しすぎる語を設問文・選択肢・解説に使わない",
    check: (d) => texts(d).flatMap((t) => (OVERCLAIM.test(t.text.normalize("NFKC")) ? [t.path] : [])),
  },
  {
    name: "explanation-length",
    appliesTo: "both",
    severity: "warn",
    summary: "総合解説は、正答の理由が分かる長さ(30 文字以上)で書く",
    check: (d) => (length(d.explanation) < 30 ? ["explanation"] : []),
  },
  {
    name: "explanation-heading",
    appliesTo: "both",
    severity: "block",
    summary:
      "解説の見出し(`## ` の行)は、決まった名前(問われている要件・正解の決め手・前提知識・解くための考え方・まとめ・他の選択肢が誤りである理由。表の別名も可)を使う",
    check: (d) =>
      [...d.explanation.matchAll(/^##\s+(.+)$/gm)].some(
        (m) => !Object.hasOwn(HEADING_KINDS, normalizeHeading(m[1] ?? "")),
      )
        ? ["explanation"]
        : [],
  },
  {
    name: "explanation-key-reference",
    appliesTo: "choice",
    severity: "block",
    summary:
      "解説で選択肢を記号で指すときは、その問題の記号だけを使う。選択肢ではない大文字 1 文字を、前後に英数字なしで書かない(ハイフンで語につながるものは除く)",
    check: onChoice((d) => {
      const keys = new Set(d.choices.map((c) => c.key));
      const paths: string[] = [];
      const fields = [
        { path: "explanation", text: d.explanation },
        ...d.choices.map((c, i) => ({ path: `choices.${i}.explanation`, text: c.explanation ?? "" })),
        ...(d.distractors ?? []).map((x, i) => ({ path: `distractors.${i}.reason`, text: x.reason })),
      ];
      for (const f of fields) {
        // アプリの relabelText と同じ境目で拾う(ハイフンで語につながる「X-Ray」などは、記号とみなさない)
        const letters = [
          ...f.text.normalize("NFKC").matchAll(/(?<![A-Za-z0-9]|[A-Za-z0-9]-)[A-Z](?![A-Za-z0-9]|-[A-Za-z0-9])/g),
        ].map((m) => m[0]);
        if (letters.some((l) => !keys.has(l))) paths.push(f.path);
      }
      return paths;
    }),
  },
  {
    name: "choice-explanation-missing",
    appliesTo: "choice",
    severity: "block",
    summary: "誤答のすべてに、誤りである理由を書く(誤答の設計の理由が、その選択肢の解説になる)",
    check: onChoice((d) =>
      d.choices.flatMap((c, i) => {
        if (d.correctAnswers.includes(c.key)) return [];
        const reason = c.explanation ?? d.distractors?.find((x) => x.key === c.key)?.reason;
        return reason === undefined || reason.trim() === "" ? [`choices.${i}.explanation`] : [];
      }),
    ),
  },
  {
    name: "choice-explanation-markup",
    appliesTo: "choice",
    severity: "block",
    summary: "選択肢ごとの解説に、見出しと箇条書きを使わない(使える記法は、太字 `**…**`・コード `` `…` ``・改行)",
    check: onChoice((d) => {
      const markup = /^[ \t]*(#{1,6}[ \t]|[-*+][ \t]|\d+\.[ \t])/m;
      return [
        ...d.choices.flatMap((c, i) => (markup.test(c.explanation ?? "") ? [`choices.${i}.explanation`] : [])),
        ...(d.distractors ?? []).flatMap((x, i) => (markup.test(x.reason) ? [`distractors.${i}.reason`] : [])),
      ];
    }),
  },
  {
    name: "rubric-criteria-count",
    appliesTo: "free-text",
    severity: "warn",
    summary: "採点基準の観点は 2 つ以上にする(1 つだけでは、部分的な理解を測れない)",
    check: (d) => (!isChoiceDraft(d) && d.rubric.criteria.length < 2 ? ["rubric.criteria"] : []),
  },
  {
    name: "rubric-keyword-short",
    appliesTo: "free-text",
    severity: "warn",
    summary: "キーワードは 2 文字以上にする(1 文字では、無関係な回答にも当たる)",
    check: (d) =>
      isChoiceDraft(d)
        ? []
        : d.rubric.criteria.flatMap((c, i) =>
            c.keywords.flatMap((k, j) => (length(k) < 2 ? [`rubric.criteria.${i}.keywords.${j}`] : [])),
          ),
  },
  {
    name: "rubric-keyword-shared",
    appliesTo: "free-text",
    severity: "warn",
    summary: "同じキーワードを、複数の観点に入れない(1 つの語で、複数の観点を満たしてしまう)",
    check: (d) => {
      if (isChoiceDraft(d)) return [];
      const seen = new Map<string, number>();
      const paths: string[] = [];
      d.rubric.criteria.forEach((c, i) => {
        for (const [j, k] of c.keywords.entries()) {
          const key = compact(k);
          const first = seen.get(key);
          if (first !== undefined && first !== i) paths.push(`rubric.criteria.${i}.keywords.${j}`);
          if (first === undefined) seen.set(key, i);
        }
      });
      return paths;
    },
  },
  {
    name: "rubric-pass-ratio",
    appliesTo: "free-text",
    severity: "warn",
    summary: "合格点は、配点の合計の 5 割以上 9 割以下にする",
    check: (d) => {
      if (isChoiceDraft(d)) return [];
      const total = d.rubric.criteria.reduce((a, c) => a + c.points, 0);
      const ratio = d.rubric.passingPoints / total;
      return ratio < 0.5 || ratio > 0.9 ? ["rubric.passingPoints"] : [];
    },
  },
  {
    name: "no-url",
    appliesTo: "both",
    severity: "block",
    summary: "設問文・選択肢・解説に URL を書かない(出典は別に記録する)",
    check: (d) => texts(d).flatMap((t) => (containsUrl(t.text) ? [t.path] : [])),
  },
  {
    name: "no-env-value",
    appliesTo: "both",
    severity: "block",
    summary: "環境固有の値(12 桁のアカウント ID、ARN、アクセスキー、メールアドレス、ローカルのパス)を書かない",
    check: (d) => texts(d).flatMap((t) => (hasEnvValue(t.text) ? [t.path] : [])),
  },
];

/** 下書きにスタイル規則を適用する。結果は、規則の名前・重さ・場所だけ(本文は含まない) */
export function checkStyle(draft: Draft, rules: readonly StyleRule[] = STYLE_RULES): Finding[] {
  return rules
    .filter((rule) => rule.appliesTo === "both" || rule.appliesTo === (isChoiceDraft(draft) ? "choice" : "free-text"))
    .flatMap((rule) => rule.check(draft).map((path): Finding => ({ rule: rule.name, severity: rule.severity, path })));
}

export interface StyleVerdict {
  /** 止める規則の違反。1 件でもあれば、下書きは先へ進めない */
  blockers: Finding[];
  /** 警告の規則の違反。報告するだけで、先へは進められる */
  warnings: Finding[];
}

export function evaluateStyle(draft: Draft, rules: readonly StyleRule[] = STYLE_RULES): StyleVerdict {
  const all = checkStyle(draft, rules);
  return {
    blockers: all.filter((f) => f.severity === "block"),
    warnings: all.filter((f) => f.severity === "warn"),
  };
}
