import type { CurriculumDomain } from "@mokumoku-exams/data-schema/curriculum-data/schema";
import type { CurriculumUnit } from "./curriculum-data.ts";

// 学習モードの構成: 分野の一覧 → 単元の一覧 → 教科書 → 問題。単元が 1 つだけの分野は、単元の一覧を飛ばす。
// 画面の経路と、「次の単元」「次の分野」の決め方を、画面から切り離した純粋な関数にして、単体テストする。

export type StudyGroup = {
  code: string;
  /** 分野の名前(資格マスタ) */
  name: string;
  /** 分野の説明(カリキュラム) */
  summary: string;
  /** 分野の単元(順番の小さい順) */
  units: CurriculumUnit[];
  /** 分野の問題の数(単元をまたいで重なる問題は、1 問と数える) */
  questionCount: number;
};

/**
 * 単元を分野ごとにまとめる。分野の並びは資格マスタの並び。単元のない分野は含めない。
 * `units` は、順番(`order`)の小さい順に並べたもの。
 */
export function groupByDomain(
  masterDomains: readonly { code: string; name: string }[],
  descriptions: readonly CurriculumDomain[],
  units: readonly CurriculumUnit[],
): StudyGroup[] {
  const summaries = new Map(descriptions.map((d) => [d.code, d.summary]));
  return masterDomains.flatMap(({ code, name }) => {
    const own = units.filter((unit) => unit.domain === code);
    if (own.length === 0) return [];
    const questionCount = new Set(own.flatMap((unit) => unit.questionIds)).size;
    return [{ code, name, summary: summaries.get(code) ?? "", units: own, questionCount }];
  });
}

export const studyHref = (examCode: string) => `/exams/${examCode}/study`;
export const domainHref = (examCode: string, domain: string) => `${studyHref(examCode)}/domains/${domain}`;
export const unitHref = (examCode: string, unitId: string) => `${studyHref(examCode)}/${unitId}`;

/** 分野の入口。単元が 1 つだけの分野は、単元の画面へ直接進む。 */
export function entryHref(examCode: string, group: StudyGroup): string {
  const [only] = group.units;
  return group.units.length === 1 && only ? unitHref(examCode, only.id) : domainHref(examCode, group.code);
}

/** 単元の画面から戻る先。分野に単元が複数あれば、その分野の単元の一覧。1 つだけなら、分野の一覧。 */
export function backHref(examCode: string, group: StudyGroup): string {
  return group.units.length > 1 ? domainHref(examCode, group.code) : studyHref(examCode);
}

export type NextStep = {
  /** 同じ分野の次の単元 */
  nextUnit: { href: string; title: string } | null;
  /** 次の分野(同じ分野に次の単元がないときだけ。その分野の入口へ進む) */
  nextDomain: { href: string; name: string } | null;
  /** 分野の一覧 */
  listHref: string;
};

/** 単元を終えたあとに進む先。次の単元があれば次の単元、なければ次の分野。どちらもなければ、分野の一覧だけ。 */
export function nextStep(examCode: string, groups: readonly StudyGroup[], unitId: string): NextStep {
  const listHref = studyHref(examCode);
  const g = groups.findIndex((group) => group.units.some((unit) => unit.id === unitId));
  const group = groups[g];
  if (!group) return { nextUnit: null, nextDomain: null, listHref };
  const u = group.units.findIndex((unit) => unit.id === unitId);
  const unit = group.units[u + 1];
  if (unit) return { nextUnit: { href: unitHref(examCode, unit.id), title: unit.title }, nextDomain: null, listHref };
  const next = groups[g + 1];
  return {
    nextUnit: null,
    nextDomain: next ? { href: entryHref(examCode, next), name: next.name } : null,
    listHref,
  };
}
