import { z } from "zod";
import { sha256 } from "../collect/fetcher.ts";
import { QUESTION_ID } from "../contract.ts";
import type { FactCard } from "../facts/schema.ts";
import { DIFFICULTIES } from "../plan/schema.ts";
import { AgentStampSchema } from "../shared/agents.ts";
import { DISTRACTOR_TYPES, DRAFT_ID, DraftSchema, FACT_ID } from "./schema.ts";
import { STYLE_RULES, STYLE_VERSION } from "./style.ts";

/** 依頼の形が変わったら上げる。鍵に入るので、上げると依頼のキャッシュが切れる */
export const REQUEST_VERSION = 5;

/** エージェントへの依頼(作業用の置き場に書く)。事実カードの主張は、言い換えた短い文 */
export const DraftRequestSchema = z.strictObject({
  examCode: z.string().min(1),
  requestKey: z.string().regex(/^[0-9a-f]{16}$/),
  planItemId: z.string().regex(/^p-[0-9a-f]{12}$/),
  domain: z.strictObject({ code: z.string().min(1), name: z.string().min(1) }),
  difficulty: z.enum(DIFFICULTIES),
  kind: z.enum(["single", "multiple", "free-text"]),
  /** 書かせる下書きの数(最大) */
  count: z.number().int().min(1).max(100),
  facts: z
    .array(
      z.strictObject({
        id: FACT_ID,
        claim: z.string().min(1),
        confidence: z.enum(["high", "medium", "low"]),
        scope: z.strictObject({ edition: z.string().optional(), region: z.string().optional() }),
        /**
         * 論点の枠の依頼だけが持つ。カードの先頭の出典のページと節(URL、人が読む節の名前、見出し)。
         * 主張が「この段階」のようにページの主題を名前で書いていないとき、どのページの話かを作問役が読めるようにする
         */
        source: z
          .strictObject({ url: z.string().min(1), section: z.string().min(1), heading: z.string().min(1) })
          .optional(),
      }),
    )
    .min(1),
  /** 選択式の下書きごとに、正答を置く記号(書かせる数と同じ長さ)。正答の位置の偏りを防ぐ。自由記述にはない */
  answerPositions: z
    .array(z.array(z.string().regex(/^[A-Z]$/)).min(1))
    .min(1)
    .optional(),
  /** 誤答の型の一覧。誤答ごとに型を選ぶ */
  distractorTypes: z.array(z.enum(DISTRACTOR_TYPES)).min(1),
  styleVersion: z.number().int(),
  /** 資格ごとの出題スタイルの指針の文書(リポジトリ直下からの相対パス)。点数票の帯のある資格だけ */
  styleGuides: z
    .array(z.string().regex(/^docs\/exam-style\/[a-z0-9-]+\.md$/))
    .min(1)
    .optional(),
  styleRules: z.array(z.strictObject({ name: z.string(), severity: z.enum(["block", "warn"]), summary: z.string() })),
  /**
   * 論点の枠(計画の項目の focus)の依頼だけが持つ。問いの形の一言。facts は枠の出典の範囲のカードだけになる
   */
  focus: z.strictObject({ instruction: z.string().min(1).max(300) }).optional(),
  /** 結果を書く場所。リポジトリ直下からの相対パス */
  outputPath: z.string().min(1),
  /** 依頼を出した時点の、エージェントの定義(役・モデルの ID・定義のハッシュ) */
  agent: AgentStampSchema.optional(),
  /**
   * 直しの依頼(ブラッシュアップ役。draft --revise)のときだけ持つ。保留の下書きを、保留の理由と検証の指摘、
   * 根拠の節の場所、周辺の事実カード(facts)を材料に直させる。書かせる数は 1
   */
  revise: z
    .strictObject({
      /** 直す下書きの ID */
      draftId: DRAFT_ID,
      /** 直す下書きの本文(保留の下書きは本文を持つ) */
      draft: DraftSchema,
      /** 保留の理由コード */
      reasons: z.array(z.string().min(1).max(64)).max(40),
      /** 検証の指摘(理由コードと場所。本文は含まない) */
      findings: z.array(z.strictObject({ code: z.string().min(1), where: z.string().min(1) })).max(40),
      /** 根拠の節の場所(出典の URL、人が読む節の名前、見出し)。本文は載せない */
      sections: z
        .array(z.strictObject({ url: z.string().min(1), section: z.string().min(1), heading: z.string().min(1) }))
        .max(10),
    })
    .optional(),
  /**
   * 書き直しの依頼(ブラッシュアップ役。draft --rewrite。ADR 0023)のときだけ持つ。非公開の問題を、判定の理由コードと、
   * 根拠の節の場所、元の根拠と周辺の事実カード(facts)を材料に直させる。書かせる数は 1。問題の ID は変わらない
   */
  rewrite: z
    .strictObject({
      /** 書き直す問題の ID(非公開のファイルにある) */
      questionId: z.string().regex(QUESTION_ID),
      /** 非公開にしたときの判定。書き直しの対象は rewritable だけ */
      verdict: z.literal("rewritable"),
      /** 現行の本文 */
      question: z.strictObject({
        questionType: z.enum(["single", "multiple"]),
        questionText: z.string().min(1),
        choices: z.array(z.strictObject({ key: z.string().regex(/^[A-Z]$/), text: z.string().min(1) })).min(2),
        correctAnswers: z.array(z.string().regex(/^[A-Z]$/)).min(1),
        explanation: z.string().min(1),
      }),
      /** 元の根拠の事実カードの ID(来歴から。facts の先頭に載る)。書き直しの根拠は、これと同じ出典・同じ出題範囲にとどめる */
      factIds: z.array(FACT_ID).min(1).max(10),
      /** 判定の理由コード(judge:*) */
      reasons: z.array(z.string().min(1).max(64)).min(1).max(10),
      /** 根拠の節の場所(出典の URL、人が読む節の名前、見出し)。本文は載せない */
      sections: z
        .array(z.strictObject({ url: z.string().min(1), section: z.string().min(1), heading: z.string().min(1) }))
        .max(10),
    })
    .optional(),
});

export type DraftRequest = z.infer<typeof DraftRequestSchema>;

/** エージェントが書く出力。依頼の鍵と計画の項目を写す */
export const DraftsOutputSchema = z.strictObject({
  examCode: z.string().min(1),
  requestKey: z.string().min(1),
  planItemId: z.string().min(1),
  drafts: z.array(DraftSchema).min(1).max(100),
});

export type DraftsOutput = z.infer<typeof DraftsOutputSchema>;

/** 依頼の種別に適用するスタイル規則の説明 */
export function styleRuleSummaries(kind: DraftRequest["kind"]): DraftRequest["styleRules"] {
  const applies = kind === "free-text" ? "free-text" : "choice";
  return STYLE_RULES.filter((r) => r.appliesTo === "both" || r.appliesTo === applies).map((r) => ({
    name: r.name,
    severity: r.severity,
    summary: r.summary,
  }));
}

/**
 * 依頼の鍵。入力(計画の項目、書かせる数、出し直しの回数、事実カードの ID と主張、規則と依頼の版、エージェントの定義のハッシュ、
 * 人が却下した下書きの数、論点の枠の依頼では問いの形の一言)から決まる。同じ入力では同じ鍵になり、取り込み済みの鍵は、再び依頼しない。
 * 人が却下した数は、1 件以上のときだけ鍵に入れる(却下のない項目の鍵は、これを足す前と変わらない)。
 * 却下が増えると鍵が変わるので、却下で足りなくなった分の依頼が、取り込み済みの依頼と同じ鍵で飛ばされない。
 * 直しの依頼は、直す下書きの ID を鍵に入れる(補充の依頼と同じ鍵にならない)。書き直しの依頼は、問題の ID と現行の本文のハッシュと、その問題の書き直しの下書きを人が却下した数を鍵に入れる。
 */
export function requestKey(input: {
  examCode: string;
  planItemId: string;
  count: number;
  round: number;
  facts: readonly { id: string; claim: string }[];
  /** エージェントの定義のハッシュ。定義が変わると鍵が変わる */
  definitionHash: string;
  /** 計画の項目の、人が却下した下書きの数 */
  humanRejected?: number;
  /** 直しの依頼のとき、直す下書きの ID */
  reviseOf?: string;
  /** 書き直しの依頼のとき、書き直す問題の ID と、その問題の書き直しの下書きを人が却下した数(数が増えると鍵が変わる) */
  rewriteOf?: { questionId: string; contentHash: string; round: number };
  /** 論点の枠の依頼のとき、問いの形の一言(変えると鍵が変わる) */
  focusInstruction?: string;
}): string {
  const canonical = JSON.stringify({
    examCode: input.examCode,
    planItemId: input.planItemId,
    count: input.count,
    round: input.round,
    facts: input.facts.map((f) => [f.id, sha256(Buffer.from(f.claim))]),
    styleVersion: STYLE_VERSION,
    requestVersion: REQUEST_VERSION,
    definitionHash: input.definitionHash,
    ...(input.humanRejected ? { humanRejected: input.humanRejected } : {}),
    ...(input.reviseOf !== undefined ? { reviseOf: input.reviseOf } : {}),
    ...(input.rewriteOf !== undefined ? { rewriteOf: input.rewriteOf } : {}),
    ...(input.focusInstruction !== undefined ? { focus: sha256(Buffer.from(input.focusInstruction)) } : {}),
  });
  return sha256(Buffer.from(canonical)).slice(0, 16);
}

const CONFIDENCE_ORDER = { high: 0, medium: 1, low: 2 } as const;

/** 事実カードの出典の URL(先頭の出典)。出典の偏りを数える単位 */
export function factSource(card: FactCard): string {
  return card.sources[0]?.url ?? "";
}

/**
 * 依頼に載せる事実カードを選ぶ。通過したカードのうち、下書きの根拠にされた回数の少ないもの(まだ根拠にされていないもの)を先に、回数が同じものの間で、
 * 重み(priority。対象サービスの目標。plan/services.ts)の小さいものを先に、
 * 根拠にされた回数の少ない出典のものを先に、確度の高いものを先に、ID の順に並べる。
 * そのうえで、同じ出典のカードが続かないよう、出典を 1 巡ずつ回して上限まで取る。同じ入力なら同じ選び方になる。
 */
export function selectFacts(
  cards: readonly FactCard[],
  usage: ReadonlyMap<string, number>,
  max: number,
  sourceUsage: ReadonlyMap<string, number> = new Map(),
  priority: (card: FactCard) => number = () => 0,
): FactCard[] {
  const sorted = [...cards].sort(
    (a, b) =>
      (usage.get(a.id) ?? 0) - (usage.get(b.id) ?? 0) ||
      priority(a) - priority(b) ||
      (sourceUsage.get(factSource(a)) ?? 0) - (sourceUsage.get(factSource(b)) ?? 0) ||
      CONFIDENCE_ORDER[a.confidence] - CONFIDENCE_ORDER[b.confidence] ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  const selected: FactCard[] = [];
  let rest = sorted;
  while (selected.length < max && rest.length > 0) {
    const seen = new Set<string>();
    const next: FactCard[] = [];
    for (const card of rest) {
      const source = factSource(card);
      if (selected.length < max && !seen.has(source)) {
        seen.add(source);
        selected.push(card);
      } else {
        next.push(card);
      }
    }
    rest = next;
  }
  return selected;
}

/** 選択式の種別ごとの、正答の位置に使う記号(単一は 4 択、複数は 5 択から 2 つ) */
const POSITION_LETTERS = { single: ["A", "B", "C", "D"], multiple: ["A", "B", "C", "D", "E"] } as const;

/** 正答の位置の組を数える鍵(記号を順に並べて連ねる) */
export function positionKey(letters: readonly string[]): string {
  return [...letters].sort().join("");
}

/**
 * 依頼の下書きごとに、正答を置く記号を決める。これまでの下書きで使われた回数(組、次に記号)の少ないものを先に、記号の順に選ぶ。
 * 選んだ分は counts に足すので、同じ実行の次の依頼は、残りの少ない位置から選ぶ。
 */
export function assignAnswerPositions(
  kind: "single" | "multiple",
  count: number,
  counts: Map<string, number>,
): string[][] {
  const letters = POSITION_LETTERS[kind];
  const candidates: string[][] =
    kind === "single" ? letters.map((l) => [l]) : letters.flatMap((a, i) => letters.slice(i + 1).map((b) => [a, b]));
  const letterCount = (l: string) =>
    [...counts.entries()].reduce((sum, [key, n]) => (key.includes(l) ? sum + n : sum), 0);
  const result: string[][] = [];
  for (let i = 0; i < count; i++) {
    const scored = candidates.map((c) => ({
      c,
      pair: counts.get(positionKey(c)) ?? 0,
      letters: c.reduce((sum, l) => sum + letterCount(l), 0),
    }));
    scored.sort((a, b) => a.pair - b.pair || a.letters - b.letters || positionKey(a.c).localeCompare(positionKey(b.c)));
    const chosen = scored[0]?.c ?? [letters[0]];
    result.push(chosen);
    counts.set(positionKey(chosen), (counts.get(positionKey(chosen)) ?? 0) + 1);
  }
  return result;
}
