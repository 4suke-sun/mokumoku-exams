import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Config } from "../config.ts";
import { normalizeText, QuestionsFileSchema } from "../contract.ts";
import { compact } from "../text.ts";
import { type Draft, isChoiceDraft } from "./schema.ts";
import { stemSimilarity } from "./similarity.ts";

/**
 * 重複の検出。公開済みの問題(data/、読み取り専用)と下書き、下書き同士を、設問文の類似度と論点で比べる。
 * モデルは呼ばない。報告は、相手の識別子と種類(類似 / 論点)と類似度だけで、本文を引用しない。
 */

export interface Thresholds {
  /** この値以上は、重複として落とす */
  duplicate: number;
  /** この値以上は、保留にして、人または検証役が確かめる */
  hold: number;
}

/** 比べる 1 件。公開済みの問題か、下書き */
export interface Candidate {
  /** 識別子。公開済みの問題は questionId、下書きは下書きの ID */
  ref: string;
  source: "existing" | "draft";
  text: string;
  /** 根拠の事実カード(下書きだけ)。昇順で、区切りをつけた 1 つの文字列 */
  factKey?: string;
  /** 正答の選択肢の文言(ならして並べ替えたもの)。選択式だけ */
  answers?: string;
}

export interface DuplicateFinding {
  level: "duplicate" | "hold";
  kind: "similar" | "topic";
  /** 比べた相手の識別子 */
  other: string;
  source: "existing" | "draft";
  /** 設問文の類似度 */
  score: number;
}

/** 論点が同じ候補とみなすのに必要な、設問文の最小の類似度。正答が同じだけの無関係な問題を除く */
const TOPIC_MIN_SIMILARITY = 0.3;
/** 正答の文言が短すぎる(数値だけなど)ときは、正答が同じでも論点が同じとはみなさない */
const ANSWERS_MIN_LENGTH = 8;

export function candidateOf(ref: string, source: Candidate["source"], draft: Draft): Candidate {
  const factKey = [...new Set(draft.factIds)].sort().join(",");
  if (!isChoiceDraft(draft)) return { ref, source, text: draft.questionText, factKey };
  const correct = draft.choices.filter((c) => draft.correctAnswers.includes(c.key));
  return {
    ref,
    source,
    text: draft.questionText,
    factKey,
    answers: correct
      .map((c) => compact(c.text))
      .sort()
      .join("|"),
  };
}

/** 1 件を、ほかの候補と比べる。自分自身(同じ識別子)は比べない */
export function findDuplicates(
  target: Candidate,
  others: readonly Candidate[],
  thresholds: Thresholds,
): DuplicateFinding[] {
  const findings: DuplicateFinding[] = [];
  for (const other of others) {
    if (other.ref === target.ref) continue;
    // 設問文は、末尾の決まり文句を外して比べる(共通の言い回しで、別の論点の設問が似て見えないように)
    const score = stemSimilarity(target.text, other.text);
    const round = Math.round(score * 100) / 100;
    if (score >= thresholds.duplicate) {
      findings.push({ level: "duplicate", kind: "similar", other: other.ref, source: other.source, score: round });
    } else if (score >= thresholds.hold) {
      findings.push({ level: "hold", kind: "similar", other: other.ref, source: other.source, score: round });
    } else if (score >= TOPIC_MIN_SIMILARITY && sameTopic(target, other)) {
      findings.push({ level: "hold", kind: "topic", other: other.ref, source: other.source, score: round });
    }
  }
  return findings;
}

/** 1 件と、ほかの候補との、設問文の最大の類似度(小数 2 桁)。比べる相手がなければ 0。自分自身は比べない */
export function maxSimilarity(target: Candidate, others: readonly Candidate[]): number {
  let best = 0;
  for (const other of others) {
    if (other.ref === target.ref) continue;
    best = Math.max(best, stemSimilarity(target.text, other.text));
  }
  return Math.round(best * 100) / 100;
}

/** 同じ事実カードの組を根拠にするか、同じ正答の組を持つ */
function sameTopic(a: Candidate, b: Candidate): boolean {
  if (a.factKey !== undefined && a.factKey !== "" && a.factKey === b.factKey) return true;
  return (
    a.answers !== undefined && a.answers.length >= ANSWERS_MIN_LENGTH && a.answers !== "" && a.answers === b.answers
  );
}

/** 公開済みの問題(data/questions.<コード>.json)を、読み取り専用で読む。ファイルがなければ空。形が違えば "invalid" */
export function readPublishedCandidates(config: Config, rootDir: string, examCode: string): Candidate[] | "invalid" {
  const file = resolve(rootDir, dirname(config.examsFile), `questions.${examCode.toLowerCase()}.json`);
  if (!existsSync(file)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return "invalid";
  }
  const parsed = QuestionsFileSchema.safeParse(raw);
  if (!parsed.success) return "invalid";
  return parsed.data.questions.map((q) => ({
    ref: q.questionId,
    source: "existing" as const,
    text: q.questionText,
    ...(q.questionType === "free-text"
      ? {}
      : {
          answers: q.choices
            .filter((c) => q.correctAnswers.includes(c.key))
            .map((c) => compact(normalizeText(c.text)))
            .sort()
            .join("|"),
        }),
  }));
}

/** 公開済みの選択式の問題の、正解の偏りの検査に使う項目だけ(種別・選択肢・正答)。ファイルがないか形が違えば空 */
export function readPublishedChoices(
  config: Config,
  rootDir: string,
  examCode: string,
): { questionType: string; choices: { key: string; text: string }[]; correctAnswers: string[] }[] {
  const file = resolve(rootDir, dirname(config.examsFile), `questions.${examCode.toLowerCase()}.json`);
  if (!existsSync(file)) return [];
  try {
    const parsed = QuestionsFileSchema.safeParse(JSON.parse(readFileSync(file, "utf8")));
    if (!parsed.success) return [];
    return parsed.data.questions.flatMap((q) =>
      q.questionType === "free-text"
        ? []
        : [{ questionType: q.questionType, choices: q.choices, correctAnswers: q.correctAnswers }],
    );
  } catch {
    return [];
  }
}
