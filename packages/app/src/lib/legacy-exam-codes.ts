import examsFile from "../../../../data/exams.json";

/** 以前の試験コード → いまの試験コード(資格マスタの `previousCodes`)。旧コードの URL の転送と、端末・アカウントの記録の移行に使う */
export const LEGACY_EXAM_CODES: Readonly<Record<string, string>> = Object.fromEntries(
  (examsFile.exams as { examCode: string; previousCodes?: string[] }[]).flatMap(({ examCode, previousCodes = [] }) =>
    previousCodes.map((old) => [old, examCode] as const),
  ),
);
