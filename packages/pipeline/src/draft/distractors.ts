import { containsUrl } from "../contract.ts";
import { compact } from "../text.ts";
import type { ChoiceDraft } from "./schema.ts";
import { similarity } from "./similarity.ts";
import { hasEnvValue } from "./style.ts";

/**
 * 誤答の検査。誤答ごとに、誤りである理由と根拠があるか、型が偏っていないか、
 * 設問文の条件のもとで正しくなりうる(正答が複数になりうる)ものがないかを、モデルを呼ばずに確かめる。
 * 報告は、規則の名前と場所(選択肢・項目)だけで、本文を引用しない。
 */

/** 誤答の検査が出すコードと、その結果。docs/question-style.md の表と一致させる(テストで確かめる) */
export const DISTRACTOR_CODES: Readonly<Record<string, "block" | "warn" | "hold">> = {
  "distractor-missing": "block",
  "distractor-unknown-key": "block",
  "distractor-duplicate": "block",
  "distractor-reason-short": "block",
  "distractor-basis-not-in-request": "block",
  "distractor-basis-scope-type": "block",
  "distractor-forbidden-text": "block",
  "distractor-type-bias": "warn",
  "similar-to-correct": "hold",
  "supported-by-fact": "hold",
};

export interface DistractorFinding {
  code: string;
  /** 場所。choices.2、distractors.1、distractors など */
  path: string;
}

export interface DistractorResult {
  /** 先へ進めない違反 */
  blockers: DistractorFinding[];
  /** 警告 */
  warnings: DistractorFinding[];
  /** 正答が複数になりうる候補。モデルによる検査(検証の段階)で確かめるまで、保留にする */
  ambiguous: DistractorFinding[];
}

/** 理由として最低限の長さ(空白を除く文字数) */
const REASON_MIN = 10;
/** 正答とほぼ同じ文言とみなす類似度 */
const SIMILAR_TO_CORRECT = 0.8;
/** 類似度で比べる文の最小の長さ。短い選択肢(数値だけなど)は、一部が違うだけで高い値になるので、比べない */
const SIMILAR_MIN_LENGTH = 15;

/** 数値とラテン文字の語(サービス名など)。数値の桁区切りは除く */
function tokens(text: string): string[] {
  const normalized = text
    .normalize("NFKC")
    .toLowerCase()
    .replace(/(\d),(?=\d)/g, "$1");
  return [...new Set(normalized.match(/\d+(?:\.\d+)?|[a-z][a-z0-9-]{2,}/g) ?? [])];
}

export function checkDistractors(
  draft: ChoiceDraft,
  context: {
    /** 依頼に載った事実カードの ID */
    factIds: ReadonlySet<string>;
    /** 根拠の事実カードの主張(draft.factIds の分) */
    claims: readonly string[];
  },
): DistractorResult {
  const result: DistractorResult = { blockers: [], warnings: [], ambiguous: [] };
  const entries = draft.distractors ?? [];
  const wrongIndexes = draft.choices.flatMap((c, i) => (draft.correctAnswers.includes(c.key) ? [] : [i]));
  const wrongKeys = new Set(wrongIndexes.map((i) => draft.choices[i]?.key));

  // 誤答ごとに、設計が 1 つある
  for (const i of wrongIndexes) {
    const key = draft.choices[i]?.key;
    if (!entries.some((e) => e.key === key)) result.blockers.push({ code: "distractor-missing", path: `choices.${i}` });
  }
  const seen = new Set<string>();
  entries.forEach((e, j) => {
    const path = `distractors.${j}`;
    if (!wrongKeys.has(e.key)) result.blockers.push({ code: "distractor-unknown-key", path });
    else if (seen.has(e.key)) result.blockers.push({ code: "distractor-duplicate", path });
    seen.add(e.key);
    // 理由と適用範囲の言い表しにも、本文と同じ禁止事項(URL、環境固有の値)を適用する
    const free = [e.reason, "scope" in e.basis ? e.basis.scope : ""];
    if (free.some((t) => containsUrl(t) || hasEnvValue(t))) {
      result.blockers.push({ code: "distractor-forbidden-text", path });
    }
    if (compact(e.reason).length < REASON_MIN) result.blockers.push({ code: "distractor-reason-short", path });
    if ("factId" in e.basis) {
      if (!context.factIds.has(e.basis.factId)) {
        result.blockers.push({ code: "distractor-basis-not-in-request", path });
      }
    } else if (e.type !== "scope-difference") {
      result.blockers.push({ code: "distractor-basis-scope-type", path });
    }
  });

  // 型が 1 種類に偏る
  if (entries.length >= 3 && new Set(entries.map((e) => e.type)).size === 1) {
    result.warnings.push({ code: "distractor-type-bias", path: "distractors" });
  }

  // 正答が複数になりうる候補: 正答とほぼ同じ文言か、根拠の主張がそのまま支える誤答
  const correct = draft.choices.filter((c) => draft.correctAnswers.includes(c.key));
  const claimTokens = new Set(context.claims.flatMap(tokens));
  for (const i of wrongIndexes) {
    const choice = draft.choices[i];
    if (choice === undefined) continue;
    const comparable = (text: string) => compact(text).length >= SIMILAR_MIN_LENGTH;
    if (
      comparable(choice.text) &&
      correct.some((c) => comparable(c.text) && similarity(c.text, choice.text) >= SIMILAR_TO_CORRECT)
    ) {
      result.ambiguous.push({ code: "similar-to-correct", path: `choices.${i}` });
      continue;
    }
    const own = tokens(choice.text);
    if (own.length >= 2 && own.every((t) => claimTokens.has(t))) {
      result.ambiguous.push({ code: "supported-by-fact", path: `choices.${i}` });
    }
  }
  return result;
}
