import type { CodeDrillFile, CodeDrillProblem } from "@mokumoku-exams/data-schema/code-drill-data/schema";
import { findPublishedExam } from "./exam-data.ts";
import type { PublishedExam } from "./types.ts";

// リポジトリ直下の data/ のコードドリル(静的な JSON)を読む。形は `npm run validate:data` が検査している。
// 型だけを参照し、検査の処理は読み込まない。サーバー側(ビルド時を含む)だけで使う。

export type { CodeDrillProblem };

/** 公開中の資格のコードドリル。ファイル名は `code-drill.<資格コードの英小文字>.json`。ファイルのない資格は null */
export async function loadCodeDrill(exam: PublishedExam): Promise<CodeDrillProblem[] | null> {
  try {
    const file = (await import(`../../../../data/code-drill.${exam.examCode.toLowerCase()}.json`)) as {
      default: CodeDrillFile;
    };
    const domainIndex = new Map(exam.domains.map((d, i) => [d.code, i]));
    const rank = (code: string) => domainIndex.get(code) ?? exam.domains.length;
    return [...file.default.problems].sort((a, b) => rank(a.domain) - rank(b.domain) || a.id.localeCompare(b.id));
  } catch {
    return null;
  }
}

/** 画面に出す問題。利用者には検証済みだけを出し、未検証は管理者のプレビュー(`preview`)にだけ出す */
export function visibleProblems(problems: readonly CodeDrillProblem[], preview: boolean): CodeDrillProblem[] {
  return preview ? [...problems] : problems.filter((problem) => problem.status === "verified");
}

export type CodeDrillPageData = { exam: PublishedExam; problems: CodeDrillProblem[] };

/** 公開中の資格のコードドリルを、画面に出す形で読む。資格かデータがない、出す問題が 1 つもないときは null(画面は 404) */
export async function loadCodeDrillPage(code: string, preview: boolean): Promise<CodeDrillPageData | null> {
  const exam = findPublishedExam(code);
  if (!exam) return null;
  const problems = await loadCodeDrill(exam);
  if (!problems) return null;
  const visible = visibleProblems(problems, preview);
  return visible.length === 0 ? null : { exam, problems: visible };
}
