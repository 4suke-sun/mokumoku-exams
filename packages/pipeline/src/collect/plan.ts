import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { EXAM_CODE, sourceUrlReason } from "../contract.ts";
import { SOURCE_KINDS } from "./ledger.ts";

/**
 * 収集の計画。資格ごとに 1 つの JSON をコミットし、何を、どこまで収集するかを明示する。計画にないものは収集しない。
 */

export const MAX_DEPTH = 3;

export const PlanSchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE),
  /** 収集を始める URL */
  sources: z
    .array(z.strictObject({ url: z.string().max(2000), kind: z.enum(SOURCE_KINDS) }))
    .min(1)
    .max(200),
  /** たどってよい範囲。リンクは、どれかの接頭辞で始まる URL だけをたどる */
  scope: z.strictObject({
    prefixes: z.array(z.string().max(2000)).min(1).max(50),
    /** 収集を始める URL から、リンクをたどる深さ。0 はたどらない */
    maxDepth: z.number().int().min(0).max(MAX_DEPTH),
  }),
  /**
   * 試験ガイドの続きのページ(分野ごとの出題範囲など)。収集を始める URL に加え、試験ガイドの抽出の材料に含める。
   * 指定がなければ、試験ガイドのページだけを抽出の材料にする
   */
  guidePages: z.array(z.string().max(2000)).max(20).optional(),
  /** 除外する URL の接頭辞 */
  exclude: z.array(z.string().max(2000)).max(100),
  /** 対象のリージョン。指定がなければ制限しない */
  regions: z
    .array(z.string().regex(/^[a-z0-9-]{1,32}$/))
    .max(30)
    .optional(),
});

export type Plan = z.infer<typeof PlanSchema>;

/** 計画の誤り。場所(項目のパス)と理由コードだけを持つ */
export interface PlanProblem {
  path: string;
  reason: string;
}

export function planPath(plansDir: string, examCode: string): string {
  return join(plansDir, `${examCode.toLowerCase()}.json`);
}

function startsWithAny(url: string, prefixes: readonly string[]): boolean {
  return prefixes.some((p) => url.startsWith(p));
}

/** 範囲の中で、除外に当たらず、出典に使える URL か */
export function inScope(plan: Plan, url: string): boolean {
  return sourceUrlReason(url) === null && startsWithAny(url, plan.scope.prefixes) && !startsWithAny(url, plan.exclude);
}

/** 計画を検査する。誤りがなければ空の一覧 */
export function checkPlan(raw: unknown, examCode: string): { plan: Plan | null; problems: PlanProblem[] } {
  const parsed = PlanSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      plan: null,
      problems: parsed.error.issues.map((i) => ({ path: i.path.join(".") || "(全体)", reason: "schema" })),
    };
  }
  const plan = parsed.data;
  const problems: PlanProblem[] = [];
  if (plan.examCode !== examCode) problems.push({ path: "examCode", reason: "exam-code-mismatch" });
  const urlLists: [string, readonly string[]][] = [
    ["sources", plan.sources.map((s) => s.url)],
    ["guidePages", plan.guidePages ?? []],
    ["scope.prefixes", plan.scope.prefixes],
    ["exclude", plan.exclude],
  ];
  for (const [name, urls] of urlLists) {
    urls.forEach((url, i) => {
      const reason = sourceUrlReason(url);
      const path = name === "sources" ? `sources.${i}.url` : `${name}.${i}`;
      if (reason !== null) problems.push({ path, reason });
      if (urls.indexOf(url) !== i) problems.push({ path, reason: "duplicate" });
    });
  }
  plan.sources.forEach((s, i) => {
    if (!startsWithAny(s.url, plan.scope.prefixes)) problems.push({ path: `sources.${i}.url`, reason: "out-of-scope" });
    if (startsWithAny(s.url, plan.exclude)) problems.push({ path: `sources.${i}.url`, reason: "excluded-listed" });
  });
  if (plan.sources.filter((s) => s.kind === "exam-guide").length > 1) {
    problems.push({ path: "sources", reason: "multiple-exam-guides" });
  }
  const guideUrl = plan.sources.find((s) => s.kind === "exam-guide")?.url;
  (plan.guidePages ?? []).forEach((url, i) => {
    const path = `guidePages.${i}`;
    if (guideUrl === undefined) problems.push({ path, reason: "no-exam-guide" });
    // 収集を始める URL と重ねない(種別を一意に決めるため。試験ガイドとの重複も含む)
    if (plan.sources.some((s) => s.url === url)) problems.push({ path, reason: "duplicate" });
    if (!startsWithAny(url, plan.scope.prefixes)) problems.push({ path, reason: "out-of-scope" });
    if (startsWithAny(url, plan.exclude)) problems.push({ path, reason: "excluded-listed" });
  });
  return { plan: problems.length === 0 ? plan : null, problems };
}

/** 計画を読んで検査する。ファイルがない・JSON でないものも誤りとして返す */
export function loadPlan(path: string, examCode: string): { plan: Plan | null; problems: PlanProblem[] } {
  if (!existsSync(path)) return { plan: null, problems: [{ path: "(ファイル)", reason: "plan-not-found" }] };
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return { plan: null, problems: [{ path: "(ファイル)", reason: "invalid-json" }] };
  }
  return checkPlan(raw, examCode);
}
