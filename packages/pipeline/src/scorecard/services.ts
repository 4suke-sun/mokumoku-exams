import { mentionedServices } from "../shared/services.ts";

/**
 * 束(問題の集まり)の、対象サービスの分布を測る(docs/exam-style/scorecard.md の「4. 束のサービスの分布」)。
 * 点数には入れず、警告として報告する。サービスの一覧は、台帳に取り込んだ試験ガイドの対象サービスの一覧を使う。
 */

export interface ServiceSpread {
  /** 測った問題の数 */
  total: number;
  /** サービスが 1 つ以上出る問題の割合 */
  mentionedShare: number;
  /** サービスが 2 つ以上出る問題の割合(複数のサービスにまたがる設問) */
  multiShare: number;
  /** 一覧のうち、1 問以上に出るサービスの数 */
  coveredServices: number;
  /** 出る問題の数が多い順のサービス(同数は一覧の順)。出ないサービスは含まない */
  ranking: { service: string; count: number; share: number }[];
}

/** 問題の本文(設問文と選択肢を 1 つにしたもの)の並びから、サービスの分布を測る */
export function serviceSpread(texts: readonly string[], services: readonly string[]): ServiceSpread {
  const found = texts.map((t) => mentionedServices(t, services));
  const total = texts.length;
  const ratio = (n: number) => (total === 0 ? 0 : n / total);
  const ranking = services
    .map((service, order) => ({ service, order, count: found.filter((f) => f.has(service)).length }))
    .filter((r) => r.count > 0)
    .sort((a, b) => b.count - a.count || a.order - b.order)
    .map(({ service, count }) => ({ service, count, share: ratio(count) }));
  return {
    total,
    mentionedShare: ratio(found.filter((f) => f.size >= 1).length),
    multiShare: ratio(found.filter((f) => f.size >= 2).length),
    coveredServices: ranking.length,
    ranking,
  };
}

/** サービスの分布の目安(試験ごとの設定 plan.overrides の services) */
export interface SpreadTargets {
  /** 1 つのサービスが出る問題の割合の上限 */
  maxShare: number;
  /** サービスが 2 つ以上出る問題の割合の下限。持たなければ見ない */
  minMultiServiceShare?: number | undefined;
}

/** 目安から外れた点。サービスの偏り(割合の上限を超えるサービス)と、複数のサービスにまたがる設問の不足 */
export function spreadWarnings(
  spread: ServiceSpread,
  targets: SpreadTargets,
): { overShare: ServiceSpread["ranking"]; multiShort: boolean } {
  return {
    overShare: spread.ranking.filter((r) => r.share > targets.maxShare),
    multiShort: targets.minMultiServiceShare !== undefined && spread.multiShare < targets.minMultiServiceShare,
  };
}
