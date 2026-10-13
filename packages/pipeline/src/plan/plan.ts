import { sha256 } from "../collect/fetcher.ts";
import type { Config } from "../config.ts";
import { allocate } from "./allocate.ts";
import { DIFFICULTIES, type Difficulty, KINDS, type Kind, type PlanFile, type PlanItem } from "./schema.ts";

type Mix<K extends string> = Record<K, number>;

export interface PlanSettings {
  targetTotal: number;
  difficultyMix: Mix<Difficulty>;
  typeMix: Mix<Kind>;
}

/** 既存の問題のうち、計画に使う項目だけ。本文は持たない */
export interface ExistingQuestion {
  domain: string;
  /** 難易度が付いていない問題は、medium として数える */
  difficulty?: Difficulty | undefined;
  kind: Kind;
}

/** 設定と試験ごとの上書きから、目標の問題数と配分を決める */
export function resolveSettings(plan: Config["plan"], examCode: string, officialQuestionCount: number): PlanSettings {
  const override = plan.overrides[examCode];
  return {
    targetTotal: override?.targetTotal ?? Math.ceil(officialQuestionCount * plan.targetMultiplier),
    difficultyMix: override?.difficultyMix ?? plan.difficultyMix,
    typeMix: override?.typeMix ?? plan.typeMix,
  };
}

export function planItemId(examCode: string, domain: string, difficulty: Difficulty, kind: Kind): string {
  return `p-${sha256(Buffer.from([examCode, domain, difficulty, kind].join("\n"))).slice(0, 12)}`;
}

/**
 * 出題計画を作る。
 * 1. 分野の重みに比例して、目標の問題数を分野へ配る。
 * 2. 分野の目標を、難易度と種別の配分で、9 つの区分へ配る。
 * 3. 既存の問題の数との差(足りない分)を出す。足りない分の合計は、分野の目標と既存の数の差に合わせる。
 */
export function buildPlan(input: {
  examCode: string;
  domains: readonly { code: string; weight: number }[];
  existing: readonly ExistingQuestion[];
  settings: PlanSettings;
}): PlanFile {
  const { examCode, domains, existing, settings } = input;
  const targets = allocate(
    settings.targetTotal,
    domains.map((d) => d.weight),
  );
  const cells = DIFFICULTIES.flatMap((difficulty) =>
    KINDS.map((kind) => ({ difficulty, kind, weight: settings.difficultyMix[difficulty] * settings.typeMix[kind] })),
  );
  const domainCodes = new Set(domains.map((d) => d.code));
  const items: PlanItem[] = [];
  const summary = domains.map((d, i) => {
    const target = targets[i] as number;
    const mine = existing.filter((q) => q.domain === d.code);
    const cellTargets = allocate(
      target,
      cells.map((c) => c.weight),
    );
    const gaps = cells.map((c, k) => {
      const have = mine.filter((q) => (q.difficulty ?? "medium") === c.difficulty && q.kind === c.kind).length;
      return Math.max(0, (cellTargets[k] as number) - have);
    });
    const missing = Math.max(0, target - mine.length);
    // 区分ごとの不足の合計は、分野の不足以上になる。分野の不足に合わせて、比例して減らす
    const counts = allocate(missing, gaps).map((n, k) => Math.min(n, gaps[k] as number));
    cells.forEach((c, k) => {
      const count = counts[k] as number;
      if (count > 0) {
        items.push({
          id: planItemId(examCode, d.code, c.difficulty, c.kind),
          domain: d.code,
          difficulty: c.difficulty,
          kind: c.kind,
          count,
        });
      }
    });
    return { domain: d.code, target, existing: mine.length, missing };
  });
  return {
    examCode,
    targetTotal: targets.reduce((a, b) => a + b, 0),
    existingTotal: existing.filter((q) => domainCodes.has(q.domain)).length,
    domains: summary,
    items,
  };
}
