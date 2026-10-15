import type { FreeTextJudgement } from "@/lib/free-text.ts";
import type { Rubric } from "@/lib/types.ts";

type Props = {
  rubric: Rubric;
  /**
   * 何を出すか。
   * - `criteria`: 観点と配点(解いた人に、採点の観点を見せる)。
   * - `keywords`: 観点と配点に、判定に使うキーワードを添える(管理者のプレビュー)。
   * - `judged`: 観点ごとの判定と、得た点(結果の画面)。`judgement` が要る。
   */
  mode: "criteria" | "keywords" | "judged";
  judgement?: FreeTextJudgement;
};

const HEADINGS: Record<Props["mode"], (rubric: Rubric) => string> = {
  criteria: (rubric) => `採点の観点(合格点 ${rubric.passingPoints} 点)`,
  keywords: (rubric) => `採点基準(合格点 ${rubric.passingPoints} 点)`,
  judged: () => "観点ごとの判定",
};

/** 自由記述の採点基準の表示。結果の画面・ブックマークの見直し・管理者のプレビューで共通に使う。 */
export function RubricView({ rubric, mode, judgement }: Props) {
  const met = new Map(judgement?.criteria.map((c) => [c.name, c.met]));
  return (
    <div className="space-y-1 text-sm">
      <h3 className="font-bold">{HEADINGS[mode](rubric)}</h3>
      <ul className="space-y-1">
        {rubric.criteria.map((criterion) => {
          if (mode === "keywords") {
            return (
              <li key={criterion.name} className="rounded border border-line p-2">
                <span className="font-bold">{criterion.name}</span>({criterion.points} 点):{" "}
                {criterion.keywords.join("、")}
              </li>
            );
          }
          const judged = mode === "judged" ? (met.get(criterion.name) ?? false) : null;
          return (
            <li key={criterion.name} className="flex justify-between gap-3 rounded border border-line p-2">
              {judged === null ? (
                <span>{criterion.name}</span>
              ) : (
                <span className={judged ? "text-correct" : "text-incorrect"}>
                  {judged ? "○ 満たしている" : "× 満たしていない"}
                  <span className="ml-2 text-fg">{criterion.name}</span>
                </span>
              )}
              <span>
                {judged === null
                  ? `${criterion.points} 点`
                  : `${judged ? criterion.points : 0} / ${criterion.points} 点`}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
