import { z } from "zod";
import type { AgentStamp } from "../shared/agents.ts";
import { detectCopy } from "../shared/copy.ts";
import type { GuideRecord, LedgerFile } from "./ledger.ts";
import { withinParaphraseLimit } from "./text-limits.ts";

/**
 * 試験ガイドの取り込み(ADR 0009)。分野・配点・出題範囲の抽出は、エージェントが作業用の置き場に書く。
 * CLI は、書かれたものを検査してから台帳に取り込み、資格マスタとの差分を報告する。マスタは書き換えない。
 */

const Paraphrase = z.string().min(1).refine(withinParaphraseLimit);
const Sha256 = z.string().regex(/^[0-9a-f]{64}$/);

/** 試験の本番の値(件数・分・点数)。正の整数 */
const ExamNumber = z.number().int().min(1);

/** エージェントが書く抽出の結果 */
export const GuideExtractSchema = z.strictObject({
  examCode: z.string().min(1),
  sourceUrl: z.string().min(1),
  contentHash: Sha256,
  /** 抽出の材料にした続きのページ。依頼の pages の url と contentHash を写す */
  pages: z
    .array(z.strictObject({ url: z.string().min(1), contentHash: Sha256 }))
    .max(20)
    .default([]),
  domains: z
    .array(
      z.strictObject({
        /** 試験ガイドの分野の番号(1 から) */
        number: z.number().int().min(1).max(20),
        name: Paraphrase,
        /** 配点(%) */
        weightPercent: z.number().min(0).max(100),
        scope: z.array(Paraphrase).max(40),
      }),
    )
    .min(1)
    .max(20),
  /** 出題数(試験ガイドが示す、受験者が解く問題の総数)。示さないときは持たない */
  questionCount: ExamNumber.optional(),
  /** 採点対象の問題数(ガイドが、総数と分けて示すとき) */
  scoredQuestionCount: ExamNumber.optional(),
  /** 試験時間(分) */
  timeMinutes: ExamNumber.optional(),
  /** 合格点 */
  passingScore: ExamNumber.optional(),
  /** スコアの上限(満点) */
  totalScore: ExamNumber.optional(),
});

export type GuideExtract = z.infer<typeof GuideExtractSchema>;

/** 抽出を依頼するときに、作業用の置き場に書く内容 */
export interface GuideRequest {
  examCode: string;
  sourceUrl: string;
  contentHash: string;
  /** 本文(キャッシュ)の場所。リポジトリ直下からの相対パス */
  bodyPath: string;
  /** 試験ガイドの続きのページ(計画の guidePages)。分野ごとの出題範囲などを読む */
  pages: { url: string; contentHash: string; bodyPath: string }[];
  /** 抽出の結果を書く場所。リポジトリ直下からの相対パス */
  outputPath: string;
  /** 依頼を出した時点の、エージェントの定義(役・モデルの ID・定義のハッシュ) */
  agent: AgentStamp;
}

/** 配点の合計の許容の幅(%)。ガイドの表記の丸めを許す */
const WEIGHT_SUM_TOLERANCE = 0.5;

export type GuideStopReason =
  | "extract-invalid"
  | "exam-mismatch"
  | "source-not-in-ledger"
  | "source-not-active"
  | "source-hash-mismatch"
  | "page-mismatch"
  | "body-not-cached"
  | "domain-numbering"
  | "weight-sum-mismatch"
  | "exam-values-invalid"
  | "verbatim-copy";

/**
 * 抽出の結果を検査し、台帳に入れる形にする。止めるときは理由コードを返す。
 * readBody は、本文のハッシュからキャッシュの本文を返す。言い換えが、試験ガイドと続きのページの本文の写しでないかを確かめる。
 * pageUrls は、計画の guidePages。抽出が、そのすべてを材料にしていることを確かめる。
 */
export function importGuide(
  raw: unknown,
  ledger: LedgerFile,
  pageUrls: readonly string[],
  readBody: (hash: string) => string | null,
  today: string,
  agent?: AgentStamp,
): { ok: true; guide: GuideRecord } | { ok: false; reason: GuideStopReason } {
  const parsed = GuideExtractSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, reason: "extract-invalid" };
  const extract = parsed.data;
  if (extract.examCode !== ledger.examCode) return { ok: false, reason: "exam-mismatch" };
  const source = ledger.sources.find((s) => s.url === extract.sourceUrl && s.kind === "exam-guide");
  if (!source) return { ok: false, reason: "source-not-in-ledger" };
  if (source.status !== "active") return { ok: false, reason: "source-not-active" };
  if (source.contentHash !== extract.contentHash) return { ok: false, reason: "source-hash-mismatch" };
  const extractUrls = extract.pages.map((p) => p.url);
  if (extractUrls.length !== pageUrls.length || pageUrls.some((u) => !extractUrls.includes(u))) {
    return { ok: false, reason: "page-mismatch" };
  }
  for (const page of extract.pages) {
    const entry = ledger.sources.find((s) => s.url === page.url);
    if (entry?.status !== "active") return { ok: false, reason: "source-not-active" };
    if (entry.contentHash !== page.contentHash) return { ok: false, reason: "source-hash-mismatch" };
  }
  const bodies = [extract.contentHash, ...extract.pages.map((p) => p.contentHash)].map(readBody);
  if (bodies.some((b) => b === null)) return { ok: false, reason: "body-not-cached" };

  // 本番の値は、形だけを検査する(数値は本文の写しではないので、写しの検査の対象にしない)
  if (
    (extract.passingScore !== undefined &&
      extract.totalScore !== undefined &&
      extract.passingScore > extract.totalScore) ||
    (extract.scoredQuestionCount !== undefined &&
      extract.questionCount !== undefined &&
      extract.scoredQuestionCount > extract.questionCount)
  ) {
    return { ok: false, reason: "exam-values-invalid" };
  }

  const numbers = extract.domains.map((d) => d.number).sort((a, b) => a - b);
  if (numbers.some((n, i) => n !== i + 1)) return { ok: false, reason: "domain-numbering" };
  const sum = extract.domains.reduce((s, d) => s + d.weightPercent, 0);
  if (Math.abs(sum - 100) > WEIGHT_SUM_TOLERANCE) return { ok: false, reason: "weight-sum-mismatch" };

  const plains = bodies.map((b) => b ?? "");
  const texts = extract.domains.flatMap((d) => [d.name, ...d.scope]);
  if (texts.some((t) => detectCopy(t, plains) !== null)) {
    return { ok: false, reason: "verbatim-copy" };
  }

  return {
    ok: true,
    guide: {
      sourceUrl: extract.sourceUrl,
      contentHash: extract.contentHash,
      pages: extract.pages,
      importedAt: today,
      ...(agent !== undefined ? { agent } : {}),
      ...examValues(extract),
      domains: [...extract.domains]
        .sort((a, b) => a.number - b.number)
        .map((d) => ({
          code: `domain${d.number}`,
          name: d.name,
          weight: Math.round(d.weightPercent * 100) / 10000,
          scope: d.scope,
        })),
    },
  };
}

/** 台帳に持つ、試験ガイドが示した本番の値(数値だけ)。どれも示さなければ持たない */
function examValues(extract: GuideExtract): { exam?: NonNullable<GuideRecord["exam"]> } {
  const exam = {
    ...(extract.questionCount !== undefined ? { questionCount: extract.questionCount } : {}),
    ...(extract.scoredQuestionCount !== undefined ? { scoredQuestionCount: extract.scoredQuestionCount } : {}),
    ...(extract.timeMinutes !== undefined ? { timeMinutes: extract.timeMinutes } : {}),
    ...(extract.passingScore !== undefined ? { passingScore: extract.passingScore } : {}),
    ...(extract.totalScore !== undefined ? { totalScore: extract.totalScore } : {}),
  };
  return Object.keys(exam).length > 0 ? { exam } : {};
}

/** 資格マスタの本番の値。持たない項目(準備中の資格など)は null */
export interface MasterExamValues {
  officialQuestionCount: number | null;
  officialTimeMinutes: number | null;
  passingScore: number | null;
  totalScore: number | null;
}

/** 突き合わせる本番の値の項目と、資格マスタの項目の対応 */
const EXAM_ITEMS = [
  { label: "出題数", guide: "questionCount", master: "officialQuestionCount" },
  { label: "試験時間", guide: "timeMinutes", master: "officialTimeMinutes" },
  { label: "合格点", guide: "passingScore", master: "passingScore" },
  { label: "満点", guide: "totalScore", master: "totalScore" },
] as const;

export type ExamItemLabel = (typeof EXAM_ITEMS)[number]["label"];

export interface GuideDiff {
  /** 試験ガイドにあって、マスタにない分野 */
  missingInMaster: string[];
  /** マスタにあって、試験ガイドにない分野 */
  extraInMaster: string[];
  /** 配点のずれ */
  weightMismatch: { code: string; guide: number; master: number }[];
  /** 本番の値の食い違い(ガイドとマスタの両方に値がある) */
  examMismatch: { item: ExamItemLabel; guide: number; master: number }[];
  /** マスタに値がない項目の、ガイドの値 */
  examMissingInMaster: { item: ExamItemLabel; guide: number }[];
}

/** 配点を同じとみなす幅(割合) */
const WEIGHT_TOLERANCE = 0.005;

export function diffWithMaster(
  guide: GuideRecord,
  master: readonly { code: string; weight: number }[],
  masterExam?: MasterExamValues,
): GuideDiff {
  const masterByCode = new Map(master.map((d) => [d.code, d.weight]));
  const guideCodes = new Set(guide.domains.map((d) => d.code));
  const diff: GuideDiff = {
    missingInMaster: [],
    extraInMaster: [],
    weightMismatch: [],
    examMismatch: [],
    examMissingInMaster: [],
  };
  // 本番の値: ガイドが示した項目だけを比べる。マスタに値がなければ、ガイドの値を報告する
  for (const item of EXAM_ITEMS) {
    const fromGuide = guide.exam?.[item.guide];
    if (fromGuide === undefined) continue;
    const fromMaster = masterExam?.[item.master] ?? null;
    if (fromMaster === null) diff.examMissingInMaster.push({ item: item.label, guide: fromGuide });
    else if (fromMaster !== fromGuide)
      diff.examMismatch.push({ item: item.label, guide: fromGuide, master: fromMaster });
  }
  for (const d of guide.domains) {
    const weight = masterByCode.get(d.code);
    if (weight === undefined) diff.missingInMaster.push(d.code);
    else if (Math.abs(weight - d.weight) > WEIGHT_TOLERANCE) {
      diff.weightMismatch.push({ code: d.code, guide: d.weight, master: weight });
    }
  }
  for (const d of master) if (!guideCodes.has(d.code)) diff.extraInMaster.push(d.code);
  return diff;
}
