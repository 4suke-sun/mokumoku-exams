import type { FactCard } from "../facts/schema.ts";
import { countServices, mentionedServices } from "../shared/services.ts";

/**
 * 対象サービスごとの出題の目標(試験ごとの設定 plan.overrides の services)。試験ガイドの対象サービスの一覧を使い、
 * 事実カードの選び方で、出ていないサービスへ寄せ、出すぎたサービスから離す。計画の項目(分野・難易度・種別)は変えない。
 */
export interface ServiceTargets {
  /** 各サービスが出る問題の数の下限 */
  minPerService: number;
  /** 1 つのサービスが出る問題の割合の上限 */
  maxShare: number;
}

export interface ServiceStatus {
  /** 出る問題の数が下限に届かないサービス */
  below: string[];
  /** 出る問題の割合が上限を超えるサービス */
  above: string[];
}

/** 問題の本文(設問文と選択肢)の並びから、目標に届かないサービスと超えるサービスを出す。並びは一覧の順 */
export function serviceStatus(
  texts: readonly string[],
  services: readonly string[],
  targets: ServiceTargets,
): ServiceStatus & { counts: Map<string, number>; total: number } {
  const counts = countServices(texts, services);
  const total = texts.length;
  return {
    counts,
    total,
    below: services.filter((s) => (counts.get(s) ?? 0) < targets.minPerService),
    above: services.filter((s) => total > 0 && (counts.get(s) ?? 0) / total > targets.maxShare),
  };
}

/**
 * 事実カードの選ぶ順の重み(小さいほど先)。主張に、下限に届かないサービスが出るカードを 0、
 * 出るサービスがすべて上限を超えるカードを 2、それ以外(サービスが出ないカードを含む)を 1 にする。
 */
export function servicePriority(card: FactCard, services: readonly string[], status: ServiceStatus): 0 | 1 | 2 {
  const found = mentionedServices(card.claim, services);
  if (found.size === 0) return 1;
  if ([...found].some((s) => status.below.includes(s))) return 0;
  if ([...found].every((s) => status.above.includes(s))) return 2;
  return 1;
}
