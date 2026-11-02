import { CATCH_ALL, COUNT_NOTE, NEGATION, statedCount } from "../draft/style.ts";
import { dice } from "../shared/similarity.ts";
import { PASSING, type ScorecardProfile } from "./profiles.ts";

/**
 * 書き方の点数票(docs/exam-style/scorecard.md)。機械で測れる項目だけで採点し、モデルの判断は入れない。
 * 結果は、項目の ID と点数と場所だけで、設問文や選択肢の本文は含まない。
 */

/** 採点する選択式の問題 */
export interface ScoreInput {
  id: string;
  type: "single" | "multiple";
  stem: string;
  choices: readonly string[];
  /** 正答の位置(0 始まり) */
  correct: readonly number[];
}

/** 問題 1 問ごとの項目の ID。A は共通、B は資格別 */
export const QUESTION_ITEMS = [
  "A1",
  "A2",
  "A3",
  "A4",
  "A5",
  "A6",
  "A7",
  "A8",
  "A9",
  "A10",
  "B1",
  "B2",
  "B3",
  "B4",
  "B5",
  "B6",
  "B7",
] as const;
export type QuestionItem = (typeof QUESTION_ITEMS)[number];

/** 共通の項目の配点(合計 60 点) */
export const COMMON_POINTS: Readonly<Record<`A${number}`, number>> = {
  A1: 5,
  A2: 10,
  A3: 5,
  A4: 10,
  A5: 5,
  A6: 5,
  A7: 5,
  A8: 5,
  A9: 5,
  A10: 5,
};

/** 束の項目の ID。1 項目 20 点 */
export const BATCH_ITEMS = ["S1", "S2", "S3", "S4", "S5"] as const;
export type BatchItem = (typeof BATCH_ITEMS)[number];
export const BATCH_ITEM_POINTS = 20;

/** 問いの末尾が敬体(です・ます)か。句点や疑問符の有無は問わない */
const POLITE_ENDING = /(でしょうか|ですか|ますか|ください|なさい)[。.!！?？]*$/;

/** 要件を示す語 */
const REQUIREMENT = /必要|したい|考えて|予定|求められ|ため|際|要件|目的|検討|計画|しています|しました|決定/;

/** 選択肢の形 */
export type ChoiceForm = "name" | "phrase" | "sentence";

export function choiceForm(text: string): ChoiceForm {
  const t = text.normalize("NFKC").trim();
  // 句点で終わるか、述語(ひらがなで終わる)で終わるものを文とする。体言止めの「こと」「もの」などは語句
  if (t.endsWith("。") || (/[ぁ-ん]$/.test(t) && !/(の|こと|もの|ため|など|とき|ほう|ところ)$/.test(t)))
    return "sentence";
  if (/^[A-Za-z0-9 ./()\-・&–—]+$/.test(t) || (/^(AWS|Amazon|Databricks)/.test(t) && [...t].length <= 40))
    return "name";
  return "phrase";
}

const chars = (text: string) => [...text].length;
const body = (stem: string) => stem.normalize("NFKC").replace(COUNT_NOTE, "").replace(/\s+/g, " ").trim();
const sentences = (text: string) => text.split(/(?<=[。？?])/).filter((s) => s.trim() !== "");

function bandScore(
  value: number,
  band: { full: readonly [number, number]; partial: readonly [number, number] },
  points: number,
) {
  if (value >= band.full[0] && value <= band.full[1]) return points;
  if (value >= band.partial[0] && value <= band.partial[1]) return Math.floor(points / 2);
  return 0;
}

export interface QuestionScore {
  id: string;
  total: number;
  /** 項目ごとの点数 */
  items: Partial<Record<QuestionItem, number>>;
  /** 満点でなかった項目 */
  lost: QuestionItem[];
  /** 止める項目(A2 の不一致・A5)の違反 */
  blocked: boolean;
}

/** 項目ごとの満点 */
export function itemMax(item: QuestionItem, profile: ScorecardProfile): number {
  if (item.startsWith("A")) return COMMON_POINTS[item as `A${number}`] ?? 0;
  const p = profile.points;
  const byItem: Record<string, number> = {
    B1: p.stemLength,
    B2: p.contextSentences,
    B3: p.contextRequirement,
    B4: p.optionLength,
    B5: p.opener,
    B6: p.questionEnding,
    B7: p.questionParagraph,
  };
  return byItem[item] ?? 0;
}

export function scoreQuestion(q: ScoreInput, profile: ScorecardProfile): QuestionScore {
  const multi = q.type === "multiple";
  const text = body(q.stem);
  const sents = sentences(text);
  const context = sents.slice(0, -1);
  const lengths = q.choices.map((c) => chars(c));
  // サービス名(括弧つきの略称を含む正式名)は長さがまちまちなので、長さの項目(A4・A10・B4)では数えない
  const lengthOf = q.choices.map((c, i) => (choiceForm(c) === "name" ? null : (lengths[i] ?? 0)));
  const measured = lengthOf.filter((n): n is number => n !== null);
  const longest = measured.length >= 2 ? Math.max(...measured) : 0;
  const shortest = measured.length >= 2 ? Math.min(...measured) : 0;
  const items: Partial<Record<QuestionItem, number>> = {};

  items.A1 = POLITE_ENDING.test(text) ? 5 : 0;
  const stated = statedCount(q.stem);
  // 択一は、設問文に「2 つの〜」のような数の語が入ることがあるので検査しない。複数選択だけ、選ぶ数と正答の数の一致を見る
  items.A2 = !multi || (stated !== null && stated === q.correct.length && stated >= 2) ? 10 : 0;
  items.A3 = q.choices.length === (multi ? 5 : 4) ? 5 : multi && q.choices.length === 4 ? 3 : 0;
  const ratio = measured.length < 2 ? 1 : shortest > 0 ? longest / shortest : Number.POSITIVE_INFINITY;
  items.A4 = longest < 20 || ratio <= profile.lengthRatio[0] ? 10 : ratio <= profile.lengthRatio[1] ? 5 : 0;
  items.A5 = q.choices.some((c) => CATCH_ALL.test(c.normalize("NFKC").trim())) ? 0 : 5;
  const negations = (q.stem.normalize("NFKC").match(NEGATION) ?? []).length;
  items.A6 = negations === 0 ? 5 : negations === 1 ? 3 : 0;
  const similar = q.choices.some((c, i) => q.choices.slice(0, i).some((p) => dice(p, c) >= profile.similarityMax));
  items.A7 = similar ? 0 : 5;
  items.A8 = new Set(q.choices.map((c) => c.trim().endsWith("。"))).size === 1 ? 5 : 0;
  const forms = new Set(q.choices.map(choiceForm));
  const onlyNameOrPhrase = [...forms].every((f) => f !== "sentence");
  items.A9 = forms.size === 1 || onlyNameOrPhrase ? 5 : forms.size === 2 ? 3 : 0;
  const first = q.correct[0];
  if (!multi && q.correct.length === 1 && first !== undefined && lengthOf[first] != null) {
    const sorted = [...measured].sort((a, b) => b - a);
    const correctLen = lengthOf[first] ?? 0;
    items.A10 = correctLen === sorted[0] && correctLen >= 1.5 * (sorted[1] ?? 0) ? 0 : 5;
  } else {
    items.A10 = 5;
  }

  const pts = profile.points;
  items.B1 = bandScore(chars(text), profile.stemLength, pts.stemLength);
  const [cMin, cMax] = profile.contextSentences;
  items.B2 = context.length >= cMin && context.length <= cMax ? pts.contextSentences : 0;
  items.B3 = context.length === 0 || REQUIREMENT.test(context.join("")) ? pts.contextRequirement : 0;
  items.B4 =
    longest <= profile.optionMaxLength[0]
      ? pts.optionLength
      : longest <= profile.optionMaxLength[1]
        ? Math.floor((pts.optionLength * 3) / 5)
        : 0;
  const openers = profile.openers.map((o) => new RegExp(`^(?:${o})`));
  items.B5 = context.length === 0 || openers.some((re) => re.test(text)) ? pts.opener : 0;
  items.B6 = POLITE_ENDING.test(text) ? pts.questionEnding : 0;
  if (profile.separateQuestionParagraph) {
    // 段落の区切りは空行(docs/data-spec.md の 6 節)。段落の中の改行は区切りにしない
    const paragraphs = q.stem.split(/\n[ \t]*\n/).filter((p) => p.trim() !== "");
    const last = paragraphs[paragraphs.length - 1] ?? "";
    items.B7 = paragraphs.length >= 2 && chars(body(last)) <= 100 ? pts.questionParagraph : 0;
  }

  const lost = QUESTION_ITEMS.filter((item) => item in items && (items[item] ?? 0) < itemMax(item, profile));
  const total = QUESTION_ITEMS.reduce((sum, item) => sum + (items[item] ?? 0), 0);
  return { id: q.id, total, items, lost, blocked: (items.A2 ?? 0) === 0 || (items.A5 ?? 0) === 0 };
}

export function questionPasses(score: QuestionScore): boolean {
  return score.total >= PASSING.question && !score.blocked;
}

export interface BatchScore {
  total: number;
  items: Record<BatchItem, number>;
  /** 測った値(割合・文字数)。本文は含まない */
  metrics: {
    multiShare: number;
    situationShare: number;
    stemMedian: number;
    stemP90: number;
    nameShare: number;
    phraseShare: number;
    sentenceShare: number;
    openerTopShare: number;
  };
}

function percentile(sortedValues: number[], p: number): number {
  return sortedValues[Math.min(sortedValues.length - 1, Math.floor(sortedValues.length * p))] ?? 0;
}

function within(value: number, band: readonly [number, number], margin: number): number {
  if (value >= band[0] && value <= band[1]) return BATCH_ITEM_POINTS;
  return value >= band[0] - margin && value <= band[1] + margin ? BATCH_ITEM_POINTS / 2 : 0;
}

/** 束(問題の集まり)の分布を採点する。呼ぶ側が、問題数が足りるかを確かめる */
export function scoreBatch(questions: readonly ScoreInput[], profile: ScorecardProfile): BatchScore {
  const b = profile.batch;
  const n = questions.length;
  const texts = questions.map((q) => body(q.stem));
  const lengths = texts.map(chars).sort((a, c) => a - c);
  const median =
    lengths.length % 2 === 1 ? (lengths[(n - 1) / 2] ?? 0) : ((lengths[n / 2 - 1] ?? 0) + (lengths[n / 2] ?? 0)) / 2;
  const p90 = percentile(lengths, 0.9);
  const forms = questions.flatMap((q) => q.choices.map(choiceForm));
  const share = (f: ChoiceForm) => forms.filter((x) => x === f).length / Math.max(forms.length, 1);
  const prefixes = new Map<string, number>();
  for (const t of texts) {
    const key = [...t].slice(0, b.openerPrefixChars).join("");
    prefixes.set(key, (prefixes.get(key) ?? 0) + 1);
  }
  const top = Math.max(...prefixes.values()) / n;
  const metrics = {
    multiShare: questions.filter((q) => q.type === "multiple").length / n,
    situationShare: texts.filter((t) => sentences(t).length - 1 >= Math.max(1, profile.contextSentences[0])).length / n,
    stemMedian: median,
    stemP90: p90,
    nameShare: share("name"),
    phraseShare: share("phrase"),
    sentenceShare: share("sentence"),
    openerTopShare: top,
  };

  const S1 = within(metrics.multiShare, b.multiShare, 0.1);
  const S2 = within(metrics.situationShare, b.situationShare, 0.1);
  const S3 =
    metrics.stemMedian >= b.stemMedian[0] && metrics.stemMedian <= b.stemMedian[1] && p90 <= b.stemP90Max
      ? BATCH_ITEM_POINTS
      : metrics.stemMedian >= b.stemMedian[0] * 0.85 &&
          metrics.stemMedian <= b.stemMedian[1] * 1.1 &&
          p90 <= b.stemP90Max * 1.2
        ? BATCH_ITEM_POINTS / 2
        : 0;
  const inBand = (v: number, band: readonly [number, number] | null) => band === null || (v >= band[0] && v <= band[1]);
  const S4Full =
    inBand(metrics.nameShare, b.nameShare) &&
    inBand(metrics.phraseShare, b.phraseShare) &&
    inBand(metrics.sentenceShare, b.sentenceShare);
  const S4 = S4Full
    ? BATCH_ITEM_POINTS
    : inBand(metrics.sentenceShare, [b.sentenceShare[0] - 0.15, b.sentenceShare[1] + 0.15]) && b.nameShare === null
      ? BATCH_ITEM_POINTS / 2
      : b.nameShare !== null && metrics.nameShare >= b.nameShare[0] - 0.1 && metrics.nameShare <= b.nameShare[1] + 0.1
        ? BATCH_ITEM_POINTS / 2
        : 0;
  const S5 = top <= b.openerTopMax ? BATCH_ITEM_POINTS : top <= b.openerTopMax + 0.15 ? BATCH_ITEM_POINTS / 2 : 0;

  const items = { S1, S2, S3, S4, S5 };
  return { total: S1 + S2 + S3 + S4 + S5, items, metrics };
}

export function batchPasses(score: BatchScore): boolean {
  return score.total >= PASSING.batch;
}
