import { z } from "zod";
import { sha256 } from "../collect/fetcher.ts";
import { DRAFT_ID } from "../decisions/decisions.ts";
import { seededRandom } from "../facts/review.ts";
import type { JudgeInput } from "../judge/input.ts";
import { JUDGE_CODES, type JudgeCode } from "../judge/schema.ts";
import { PathsError } from "../shared/errors.ts";

/**
 * 判定役の評価用のデータ(ADR 0021)。人が承認し、点数票の機械の観点を満たす下書きを「基準を満たす」対照にし、
 * それに欠陥を仕込んだ変種を「基準を満たさない」例にする。変種ごとに、元の下書きの ID、欠陥の種類、期待する判定を、ラベルとして持つ。
 * 同じ入力と同じ種からは、同じデータができる。作業用の置き場にだけ置き、`data/` には書かない(下書きの本文を持つため、コミットしない)。
 * 評価用の事例の ID(`e-` で始まる)は、公開データの問題 ID と重ならない。
 */

/** 仕込む欠陥の種類 */
export const DEFECT_KINDS = [
  "type-broken",
  "situation-unnatural",
  "choices-weak",
  "explanation-inconsistent",
  "not-unique",
] as const;
export type DefectKind = (typeof DEFECT_KINDS)[number];

export const CASE_KINDS = ["control", ...DEFECT_KINDS] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const DEFECT_LABEL: Record<DefectKind, string> = {
  "type-broken": "設問の型の崩れ(状況を落とす)",
  "situation-unnatural": "状況の不自然さ(答えと無関係な事情を足す)",
  "choices-weak": "弱い選択肢(誤答を無関係な文に差し替える)",
  "explanation-inconsistent": "解説の食い違い(別の選択肢を正解と述べる)",
  "not-unique": "正答が決まらない(誤答を正答と同じ文に差し替える)",
};

/** 欠陥ごとに、判定役が挙げれば「理由が合っている」とみなす理由コード */
export const EXPECTED_CODES: Record<DefectKind, readonly JudgeCode[]> = {
  "type-broken": ["type-mismatch", "situation-unnatural"],
  "situation-unnatural": ["situation-unnatural"],
  "choices-weak": ["choices-weak"],
  "explanation-inconsistent": ["explanation-inconsistent"],
  "not-unique": ["not-unique"],
};

export const CASE_ID = z.string().regex(/^e-[0-9a-f]{12}$/);

const ChoiceKey = z.string().regex(/^[A-Z]$/);

export const JudgeInputSchema = z.strictObject({
  questionId: CASE_ID,
  kind: z.enum(["single", "multiple"]),
  questionText: z.string().min(1),
  choices: z.array(z.strictObject({ key: ChoiceKey, text: z.string().min(1) })).min(2),
  correctAnswers: z.array(ChoiceKey).min(1),
  explanation: z.string().min(1),
});

export const JudgeEvalCaseSchema = z.strictObject({
  caseId: CASE_ID,
  /** 元にした、人が承認した下書きの ID */
  baseDraftId: DRAFT_ID,
  /** control は基準を満たす対照。それ以外は、仕込んだ欠陥の種類 */
  kind: z.enum(CASE_KINDS),
  /** 期待する判定: 対照は publish、変種は not-publish(rewritable か unpublish) */
  expected: z.enum(["publish", "not-publish"]),
  input: JudgeInputSchema,
});

export const JudgeEvalDatasetSchema = z.strictObject({
  examCode: z.string().min(1),
  seed: z.number().int().min(0),
  perKind: z.number().int().min(1),
  cases: z.array(JudgeEvalCaseSchema),
});

export type JudgeEvalCase = z.infer<typeof JudgeEvalCaseSchema>;
export type JudgeEvalDataset = z.infer<typeof JudgeEvalDatasetSchema>;

export class JudgeEvalDataError extends PathsError {
  constructor(paths: string[]) {
    super("評価用データの誤り", paths);
  }
}

/** 評価用のデータを読んで検査する。ラベルの欠落、未知の欠陥の種類、期待する判定の食い違い、ID の重複、対照と変種の数の不一致を落とす。場所だけを持つ */
export function parseJudgeDataset(raw: unknown): JudgeEvalDataset {
  const parsed = JudgeEvalDatasetSchema.safeParse(raw);
  if (!parsed.success) throw new JudgeEvalDataError(parsed.error.issues.map((i) => i.path.join(".") || "(全体)"));
  const problems: string[] = [];
  const seen = new Set<string>();
  parsed.data.cases.forEach((c, i) => {
    if (seen.has(c.caseId)) problems.push(`cases.${i}.caseId`);
    seen.add(c.caseId);
    if (c.input.questionId !== c.caseId) problems.push(`cases.${i}.input.questionId`);
    if ((c.kind === "control") !== (c.expected === "publish")) problems.push(`cases.${i}.expected`);
  });
  const controls = parsed.data.cases.filter((c) => c.kind === "control").length;
  if (controls !== parsed.data.cases.length - controls) problems.push("cases");
  if (problems.length > 0) throw new JudgeEvalDataError(problems);
  return parsed.data;
}

export function judgeDatasetHash(dataset: JudgeEvalDataset): string {
  return sha256(Buffer.from(JSON.stringify(dataset)));
}

export function caseId(baseDraftId: string, kind: CaseKind, seed: number): string {
  return `e-${sha256(Buffer.from(`judge|${baseDraftId}|${kind}|${seed}`)).slice(0, 12)}`;
}

// ---- 欠陥の仕込み ----

/** 状況に足す、答えと無関係な事情 */
export const UNNATURAL_SENTENCE = "なお、同社の社員食堂は毎週水曜日が定休日で、来月から営業時間が変わる予定です。";

/** 誤答に差し替える、無関係な文 */
export const NOISE_CHOICE = "社員食堂のメニューを変更する。";

type Mutation = (input: JudgeInput) => JudgeInput | null;

const wrongKeys = (i: JudgeInput) =>
  i.choices
    .map((c) => c.key)
    .filter((k) => !i.correctAnswers.includes(k))
    .sort();

/** 設問文を、状況の部分と、問いの部分(最後の段落、段落がなければ最後の文)に分ける。分けられなければ null */
function splitStem(text: string): { situation: string; question: string; separator: string } | null {
  const paragraphs = text.split(/\n\s*\n/);
  if (paragraphs.length >= 2) {
    return {
      situation: paragraphs.slice(0, -1).join("\n\n"),
      question: paragraphs[paragraphs.length - 1] as string,
      separator: "\n\n",
    };
  }
  const sentences = text.split(/(?<=[。？?])/).filter((s) => s.trim() !== "");
  if (sentences.length < 2) return null;
  return {
    situation: sentences.slice(0, -1).join(""),
    question: sentences[sentences.length - 1] as string,
    separator: "",
  };
}

const MUTATIONS: Record<DefectKind, Mutation> = {
  /** 状況を落として、問いだけにする */
  "type-broken": (i) => {
    const parts = splitStem(i.questionText);
    return parts === null ? null : { ...i, questionText: parts.question.trim() };
  },
  /** 状況に、答えと無関係な事情を足す(状況がなければ、設問文の前に置く) */
  "situation-unnatural": (i) => {
    const parts = splitStem(i.questionText);
    const questionText =
      parts === null
        ? `${UNNATURAL_SENTENCE}${i.questionText}`
        : `${parts.situation}${UNNATURAL_SENTENCE}${parts.separator}${parts.question}`;
    return { ...i, questionText };
  },
  /** 誤答の 1 つを、無関係な文に差し替える */
  "choices-weak": (i) => {
    const wrong = wrongKeys(i)[0];
    if (wrong === undefined) return null;
    return { ...i, choices: i.choices.map((c) => (c.key === wrong ? { ...c, text: NOISE_CHOICE } : c)) };
  },
  /** 解説の先頭に、別の(誤答の)選択肢を正解とする文を足す */
  "explanation-inconsistent": (i) => {
    const wrong = wrongKeys(i)[0];
    if (wrong === undefined) return null;
    return { ...i, explanation: `正解は選択肢 ${wrong} です。\n\n${i.explanation}` };
  },
  /** 誤答の 1 つを、正答と同じ文に差し替える(複数の正解になりうる) */
  "not-unique": (i) => {
    const wrong = wrongKeys(i)[0];
    const right = i.choices.find((c) => i.correctAnswers.includes(c.key));
    if (wrong === undefined || right === undefined) return null;
    return { ...i, choices: i.choices.map((c) => (c.key === wrong ? { ...c, text: right.text } : c)) };
  },
};

export interface JudgeDatasetBase {
  id: string;
  /** 元の下書きの内容(questionId は仮。事例の ID に置き換える) */
  input: JudgeInput;
}

const withId = (input: JudgeInput, id: string): JudgeEvalCase["input"] =>
  ({ ...input, questionId: id }) as JudgeEvalCase["input"];

/**
 * 評価用のデータを作る。欠陥の種類ごとに perKind 件を目安に、変種を作る(種類を順に回し、元の下書きを乱数の種で並べて割り当てる)。
 * 仕込めない組は飛ばす。基準を満たすもの(対照)は、欠陥のあるものと同じ数にそろえる。
 */
export function buildJudgeDataset(
  examCode: string,
  bases: readonly JudgeDatasetBase[],
  options: { seed: number; perKind: number },
): { dataset: JudgeEvalDataset; skipped: Record<DefectKind, number> } {
  const random = seededRandom(options.seed);
  const order = [...bases].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as JudgeDatasetBase, order[i] as JudgeDatasetBase];
  }
  const skipped = Object.fromEntries(DEFECT_KINDS.map((k) => [k, 0])) as Record<DefectKind, number>;
  const used = new Map<DefectKind, Set<string>>(DEFECT_KINDS.map((k) => [k, new Set()]));
  const faulty: JudgeEvalCase[] = [];
  for (let round = 0; round < options.perKind; round++) {
    for (const kind of DEFECT_KINDS) {
      const taken = used.get(kind) as Set<string>;
      const start = (round * 7 + DEFECT_KINDS.indexOf(kind)) % Math.max(order.length, 1);
      let made = false;
      for (let step = 0; step < order.length && !made; step++) {
        const base = order[(start + step) % order.length] as JudgeDatasetBase;
        if (taken.has(base.id)) continue;
        const mutated = MUTATIONS[kind](base.input);
        if (mutated === null || JSON.stringify(mutated) === JSON.stringify(base.input)) continue;
        taken.add(base.id);
        const id = caseId(base.id, kind, options.seed);
        faulty.push({ caseId: id, baseDraftId: base.id, kind, expected: "not-publish", input: withId(mutated, id) });
        made = true;
      }
      if (!made) skipped[kind]++;
    }
  }
  const count = Math.min(faulty.length, order.length);
  const controls: JudgeEvalCase[] = order.slice(0, count).map((base) => {
    const id = caseId(base.id, "control", options.seed);
    return { caseId: id, baseDraftId: base.id, kind: "control", expected: "publish", input: withId(base.input, id) };
  });
  return {
    dataset: {
      examCode,
      seed: options.seed,
      perKind: options.perKind,
      cases: [...controls, ...faulty.slice(0, count)],
    },
    skipped,
  };
}

/** 欠陥の理由コードのうち、型の一覧にないもの(定義のずれを検査で見つける) */
export const unknownExpectedCodes = (): string[] =>
  Object.values(EXPECTED_CODES)
    .flat()
    .filter((c) => !(JUDGE_CODES as readonly string[]).includes(c));
