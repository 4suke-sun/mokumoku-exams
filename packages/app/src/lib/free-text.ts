import type { Rubric } from "./types.ts";

/** 観点ごとの判定 */
export type CriterionJudgement = { name: string; points: number; met: boolean };

/** 自由記述の判定。満たした観点の配点の合計(`earned`)が、合格点以上なら正解。 */
export type FreeTextJudgement = {
  criteria: CriterionJudgement[];
  earned: number;
  /** 配点の合計(満点) */
  total: number;
  passingPoints: number;
  passed: boolean;
};

/** キーワードとの照合のために、全角・半角、大文字・小文字の違いをならし、空白を除く。 */
export function normalizeForMatch(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

/**
 * 自由記述の回答を、採点基準で判定する。外部のサービスは使わない。
 * 観点は、キーワードのどれかを回答が含めば満たす。ならすと空になるキーワードは、どの回答にも含まれないものとして扱う。
 * 画面の採点と、サーバーの採点し直し(復習プール)の両方で、この関数を使う。
 */
export function judgeFreeText(rubric: Rubric, answer: string): FreeTextJudgement {
  const normalized = normalizeForMatch(answer);
  const criteria = rubric.criteria.map((criterion) => ({
    name: criterion.name,
    points: criterion.points,
    met: criterion.keywords.some((keyword) => {
      const target = normalizeForMatch(keyword);
      return target !== "" && normalized.includes(target);
    }),
  }));
  const earned = criteria.reduce((sum, c) => sum + (c.met ? c.points : 0), 0);
  const total = criteria.reduce((sum, c) => sum + c.points, 0);
  return { criteria, earned, total, passingPoints: rubric.passingPoints, passed: earned >= rubric.passingPoints };
}
