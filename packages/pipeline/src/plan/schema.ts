import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { z } from "zod";
import { EXAM_CODE } from "../contract.ts";

/**
 * 出題計画(ADR 0007)。分野の配点から目標の問題数を出し、既存の問題との差分(足りない分)を、
 * 分野・難易度・種別ごとに持つ。作業用の置き場に書き、コミットしない。
 */

export const DIFFICULTIES = ["easy", "medium", "hard"] as const;
/** 問題の種別。data-spec の questionType と同じ */
export const KINDS = ["single", "multiple", "free-text"] as const;

export type Difficulty = (typeof DIFFICULTIES)[number];
export type Kind = (typeof KINDS)[number];

const DOMAIN_CODE = z.string().regex(/^domain[1-9][0-9]?$/);
const COUNT = z.number().int().min(0).max(100000);

export const PlanItemSchema = z.strictObject({
  /** 分野・難易度・種別から決まる。同じ計画なら同じ ID */
  id: z.string().regex(/^p-[0-9a-f]{12}$/),
  domain: DOMAIN_CODE,
  difficulty: z.enum(DIFFICULTIES),
  kind: z.enum(KINDS),
  /** 足りない問題の数 */
  count: z.number().int().min(1).max(100000),
});

export const PlanFileSchema = z
  .strictObject({
    examCode: z.string().regex(EXAM_CODE),
    /** 目標の問題数(分野ごとの目標の合計) */
    targetTotal: COUNT,
    existingTotal: COUNT,
    domains: z.array(
      z.strictObject({
        domain: DOMAIN_CODE,
        target: COUNT,
        existing: COUNT,
        /** 足りない数。目標が満たされていれば 0 */
        missing: COUNT,
      }),
    ),
    items: z.array(PlanItemSchema),
  })
  .superRefine((plan, ctx) => {
    const sum = plan.domains.reduce((a, d) => a + d.target, 0);
    if (sum !== plan.targetTotal) {
      ctx.addIssue({ code: "custom", path: ["targetTotal"], message: "分野の目標の合計と一致しません" });
    }
    const codes = plan.domains.map((d) => d.domain);
    if (new Set(codes).size !== codes.length) {
      ctx.addIssue({ code: "custom", path: ["domains"], message: "分野が重複しています" });
    }
    const ids = plan.items.map((i) => i.id);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["items"], message: "項目の ID が重複しています" });
    }
    plan.domains.forEach((d, i) => {
      if (d.missing !== Math.max(0, d.target - d.existing)) {
        ctx.addIssue({
          code: "custom",
          path: ["domains", i, "missing"],
          message: "不足の数が目標と既存の差ではありません",
        });
      }
      const total = plan.items.filter((item) => item.domain === d.domain).reduce((a, item) => a + item.count, 0);
      if (total !== d.missing) {
        ctx.addIssue({ code: "custom", path: ["items"], message: "項目の数の合計が不足の数と一致しません" });
      }
    });
  });

export type PlanItem = z.infer<typeof PlanItemSchema>;
export type PlanFile = z.infer<typeof PlanFileSchema>;

/** 出題計画の検査の誤り。場所(項目のパス)だけを持ち、値は持たない */
export class PlanError extends Error {
  readonly paths: string[];
  constructor(paths: string[]) {
    super("出題計画の誤り");
    this.paths = paths;
  }
}

export function planPath(workDir: string, examCode: string): string {
  return join(workDir, "plan", examCode.toLowerCase(), "plan.json");
}

export function parsePlan(raw: unknown): PlanFile {
  const parsed = PlanFileSchema.safeParse(raw);
  if (!parsed.success) throw new PlanError(parsed.error.issues.map((i) => i.path.join(".") || "(全体)"));
  return parsed.data;
}

/** 書き出す前に検査する。並びは固定(分野・難易度・種別の順) */
export function serializePlan(plan: PlanFile): string {
  return `${JSON.stringify(parsePlan(plan), null, 2)}\n`;
}

/** 読む。ファイルがなければ null */
export function readPlan(path: string): PlanFile | null {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new PlanError(["(JSON の形)"]);
  }
  return parsePlan(raw);
}

/** 書く。一時ファイルに書いてから置き換えるので、途中で止まっても壊れたファイルを残さない */
export function writePlan(path: string, plan: PlanFile): void {
  const text = serializePlan(plan);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}
