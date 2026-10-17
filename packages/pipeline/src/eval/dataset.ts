import { z } from "zod";
import { sha256 } from "../collect/fetcher.ts";
import { DRAFT_ID } from "../decisions/decisions.ts";
import { type ChoiceDraft, ChoiceDraftSchema } from "../draft/schema.ts";
import { seededRandom } from "../facts/review.ts";
import { PathsError } from "../shared/errors.ts";

/**
 * 検証役の評価用のデータ(ADR 0009)。人が承認した下書きを誤りのない対照にし、承認した下書きに誤りを仕込んだ変種を、誤りのある例にする。
 * 変種ごとに、元の下書きの ID、仕込んだ誤りの種類、期待する判定を、ラベルとして持つ。
 * 同じ入力と同じ種からは、同じデータができる。作業用の置き場にだけ置き、`data/` には書かない(下書きの本文を持つため、コミットしない)。
 * 評価用の問題の ID(`e-` で始まる)は、公開データの問題 ID(`<大文字の接頭辞>-<4 桁>`)と重ならない。
 */

/** 仕込む誤りの種類 */
export const ERROR_KINDS = ["wrong-answer", "unsupported-claim", "ambiguous-choice", "stale-fact"] as const;
export type ErrorKind = (typeof ERROR_KINDS)[number];

export const CASE_KINDS = ["control", ...ERROR_KINDS] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const ERROR_KIND_LABEL: Record<ErrorKind, string> = {
  "wrong-answer": "誤った正解",
  "unsupported-claim": "根拠のない主張",
  "ambiguous-choice": "曖昧な選択肢(複数の正解になりうる)",
  "stale-fact": "古い版の記述",
};

export const CASE_ID = z.string().regex(/^e-[0-9a-f]{12}$/);

export const EvalCaseSchema = z.strictObject({
  caseId: CASE_ID,
  /** 元にした、人が承認した下書きの ID */
  baseDraftId: DRAFT_ID,
  /** control は誤りのない対照。それ以外は、仕込んだ誤りの種類 */
  kind: z.enum(CASE_KINDS),
  /** 期待する判定: 対照は pass、変種は not-pass(保留か不採用) */
  expected: z.enum(["pass", "not-pass"]),
  draft: ChoiceDraftSchema,
});

export const EvalDatasetSchema = z.strictObject({
  examCode: z.string().min(1),
  seed: z.number().int().min(0),
  perKind: z.number().int().min(1),
  cases: z.array(EvalCaseSchema),
});

export type EvalCase = z.infer<typeof EvalCaseSchema>;
export type EvalDataset = z.infer<typeof EvalDatasetSchema>;

export class EvalDataError extends PathsError {
  constructor(paths: string[]) {
    super("評価用データの誤り", paths);
  }
}

/** 評価用のデータを読んで検査する。ラベルの欠落、未知の誤りの種類、期待する判定の食い違い、ID の重複、対照と変種の数の不一致を落とす。場所だけを持つ */
export function parseDataset(raw: unknown): EvalDataset {
  const parsed = EvalDatasetSchema.safeParse(raw);
  if (!parsed.success) throw new EvalDataError(parsed.error.issues.map((i) => i.path.join(".") || "(全体)"));
  const problems: string[] = [];
  const seen = new Set<string>();
  parsed.data.cases.forEach((c, i) => {
    if (seen.has(c.caseId)) problems.push(`cases.${i}.caseId`);
    seen.add(c.caseId);
    if ((c.kind === "control") !== (c.expected === "pass")) problems.push(`cases.${i}.expected`);
  });
  const controls = parsed.data.cases.filter((c) => c.kind === "control").length;
  if (controls !== parsed.data.cases.length - controls) problems.push("cases");
  if (problems.length > 0) throw new EvalDataError(problems);
  return parsed.data;
}

/** データのハッシュ。レポートに載せ、どのデータで測ったかを示す */
export function datasetHash(dataset: EvalDataset): string {
  return sha256(Buffer.from(JSON.stringify(dataset)));
}

export function caseId(baseDraftId: string, kind: CaseKind, seed: number): string {
  return `e-${sha256(Buffer.from(`${baseDraftId}|${kind}|${seed}`)).slice(0, 12)}`;
}

// ---- 誤りの仕込み ----

/** 解説に足す、節にない断定(適用範囲や条件を超えた言い切り) */
export const UNSUPPORTED_SENTENCE =
  "なお、この仕様は、すべての条件で例外なく適用され、事前の申請や確認なしに、上限を超えて利用できる。";

type Mutation = (draft: ChoiceDraft) => ChoiceDraft | null;

const wrongKeys = (d: ChoiceDraft) =>
  d.choices
    .map((c) => c.key)
    .filter((k) => !d.correctAnswers.includes(k))
    .sort();

const MUTATIONS: Record<ErrorKind, Mutation> = {
  /** 正解を、誤答だった選択肢に差し替える */
  "wrong-answer": (d) => {
    const wrong = wrongKeys(d)[0];
    if (wrong === undefined) return null;
    const rest = d.correctAnswers.slice(1);
    return { ...d, correctAnswers: [...rest, wrong].sort() };
  },
  /** 解説に、節にない断定を足す */
  "unsupported-claim": (d) => {
    const explanation = `${d.explanation}${UNSUPPORTED_SENTENCE}`;
    return explanation.length > 3000 ? null : { ...d, explanation };
  },
  /** 誤答の 1 つを、正答と同じ文に差し替える(複数の正解になりうる) */
  "ambiguous-choice": (d) => {
    const wrong = wrongKeys(d)[0];
    const right = d.choices.find((c) => d.correctAnswers.includes(c.key));
    if (wrong === undefined || right === undefined) return null;
    return { ...d, choices: d.choices.map((c) => (c.key === wrong ? { ...c, text: right.text } : c)) };
  },
  /** 正答の選択肢と解説の数値を、別の値(古い版の値の想定)に差し替える */
  "stale-fact": (d) => {
    const right = d.choices.find((c) => d.correctAnswers.includes(c.key));
    const number = right ? /\d+/.exec(right.text)?.[0] : undefined;
    if (right === undefined || number === undefined) return null;
    const replaced = String(Number(number) + 10);
    return {
      ...d,
      choices: d.choices.map((c) => (c.key === right.key ? { ...c, text: c.text.replace(number, replaced) } : c)),
      explanation: d.explanation.split(number).join(replaced),
    };
  },
};

export interface DatasetBase {
  id: string;
  draft: ChoiceDraft;
}

/**
 * 評価用のデータを作る。誤りの種類ごとに perKind 件を目安に、変種を作る(種類を順に回し、元の下書きを乱数の種で並べて割り当てる)。
 * 仕込めない組(正解以外の選択肢がない、数値がない、など)は飛ばす。誤りのないもの(対照)は、誤りのあるものと同じ数にそろえる。
 */
export function buildDataset(
  examCode: string,
  bases: readonly DatasetBase[],
  options: { seed: number; perKind: number },
): { dataset: EvalDataset; skipped: Record<ErrorKind, number> } {
  const random = seededRandom(options.seed);
  const order = [...bases].sort((a, b) => (a.id < b.id ? -1 : 1));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j] as DatasetBase, order[i] as DatasetBase];
  }
  const skipped: Record<ErrorKind, number> = {
    "wrong-answer": 0,
    "unsupported-claim": 0,
    "ambiguous-choice": 0,
    "stale-fact": 0,
  };
  const used = new Map<ErrorKind, Set<string>>(ERROR_KINDS.map((k) => [k, new Set()]));
  const faulty: EvalCase[] = [];
  for (let round = 0; round < options.perKind; round++) {
    for (const kind of ERROR_KINDS) {
      const taken = used.get(kind) as Set<string>;
      const start = (round * 7 + ERROR_KINDS.indexOf(kind)) % Math.max(order.length, 1);
      let made = false;
      for (let step = 0; step < order.length && !made; step++) {
        const base = order[(start + step) % order.length] as DatasetBase;
        if (taken.has(base.id)) continue;
        const mutated = MUTATIONS[kind](base.draft);
        if (mutated === null || JSON.stringify(mutated) === JSON.stringify(base.draft)) continue;
        taken.add(base.id);
        faulty.push({
          caseId: caseId(base.id, kind, options.seed),
          baseDraftId: base.id,
          kind,
          expected: "not-pass",
          draft: mutated,
        });
        made = true;
      }
      if (!made) skipped[kind]++;
    }
  }
  // 誤りのないものを、誤りのあるものと同じ数にそろえる(元の下書きが足りなければ、両方を減らす)
  const count = Math.min(faulty.length, order.length);
  const controls: EvalCase[] = order.slice(0, count).map((base) => ({
    caseId: caseId(base.id, "control", options.seed),
    baseDraftId: base.id,
    kind: "control",
    expected: "pass",
    draft: base.draft,
  }));
  const cases = [...controls, ...faulty.slice(0, count)];
  return {
    dataset: { examCode, seed: options.seed, perKind: options.perKind, cases },
    skipped,
  };
}
