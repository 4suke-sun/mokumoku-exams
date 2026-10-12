import type {
  CurriculumDomain,
  CurriculumFile,
  CurriculumStage,
  CurriculumUnit,
} from "../../../../scripts/lib/curriculum-data/schema.ts";
import type { PublishedExam } from "./types.ts";

// リポジトリ直下の data/ のカリキュラム(静的な JSON)を読む。形と問題 ID は `npm run validate:data` が検査している。
// 型だけを参照し、検査の処理は読み込まない(ADR 0004 と同じ方針)。サーバー側(ビルド時を含む)だけで使う。

export type { CurriculumDomain, CurriculumStage, CurriculumUnit };

/** `type` のない図は、流れの図として扱う(データの検査と同じ決まり) */
function withDiagramType(unit: CurriculumUnit): CurriculumUnit {
  return {
    ...unit,
    sections: unit.sections.map((section) =>
      section.diagram && !("type" in section.diagram)
        ? { ...section, diagram: { type: "flow" as const, ...(section.diagram as object) } as typeof section.diagram }
        : section,
    ),
  };
}

/** 単元と、単元の中の段階を、順番(`order`)の小さい順に並べる。 */
export function sortUnits(units: readonly CurriculumUnit[]): CurriculumUnit[] {
  return [...units]
    .sort((a, b) => a.order - b.order)
    .map((unit) => (unit.stages ? { ...unit, stages: [...unit.stages].sort((a, b) => a.order - b.order) } : unit));
}

/** カリキュラムの全体: 分野の説明と、順番に並べた単元 */
export type Curriculum = { domains: CurriculumDomain[]; units: CurriculumUnit[] };

/**
 * 公開中の資格のカリキュラムを読む。ファイル名は `curriculum.<資格コードの英小文字>.json`。
 * カリキュラムは任意で、ファイルのない資格は null(学習モードを使えない)。
 */
export async function loadCurriculumFile(exam: PublishedExam): Promise<Curriculum | null> {
  try {
    const file = (await import(`../../../../data/curriculum.${exam.examCode.toLowerCase()}.json`)) as {
      default: CurriculumFile;
    };
    return { domains: file.default.domains, units: sortUnits(file.default.units.map(withDiagramType)) };
  } catch {
    return null;
  }
}

/** 公開中の資格のカリキュラムの単元を、順番に並べて返す。ファイルのない資格は null。 */
export async function loadCurriculum(exam: PublishedExam): Promise<CurriculumUnit[] | null> {
  return (await loadCurriculumFile(exam))?.units ?? null;
}
