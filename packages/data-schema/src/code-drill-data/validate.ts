/**
 * コードドリルのデータの検査: 各ファイルのスキーマの検査と、資格マスタとの照合(分野のコード、問題 ID の接頭辞)。
 * 純粋な関数にして単体テストする(ファイルの読み込みは scripts/validate-code-drill-data.ts)。
 * 報告は、場所(ファイル、項目の位置)と種類だけにする。入力の値は含めない。
 */
import type { DataFile } from "../exam-data/validate.ts";
import { formatIssues } from "../exam-data/validate.ts";
import { CodeDrillFileSchema } from "./schema.ts";

const CODE_DRILL_FILE = /^code-drill\.([a-z][a-z0-9]{1,5}-[a-z][a-z0-9]{1,9}-[a-z0-9]{2,4})\.json$/;

type Context = {
  /** 公開中の資格ごとの、資格マスタの分野のコードと、問題 ID の接頭辞 */
  exams: ReadonlyMap<string, { domains: ReadonlySet<string>; idPrefix?: string }>;
};

export function validateCodeDrillData(files: DataFile[], { exams }: Context): string[] {
  const errors: string[] = [];
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const match = CODE_DRILL_FILE.exec(file.name);
    if (!match?.[1]) {
      errors.push(`${file.name}: ファイル名が code-drill.<コード(英小文字と数字)>.json の形ではありません`);
      continue;
    }
    const code = match[1].toUpperCase();
    const parsed = CodeDrillFileSchema.safeParse(file.data);
    if (!parsed.success) {
      errors.push(...formatIssues(file.name, parsed.error, file.data));
      continue;
    }
    if (parsed.data.examCode !== code) {
      errors.push(`${file.name}: examCode がファイル名のコードと一致しません`);
      continue;
    }
    const exam = exams.get(code);
    if (!exam) {
      errors.push(`${file.name}: 公開中の資格のコードドリルではありません`);
      continue;
    }
    parsed.data.problems.forEach((problem, i) => {
      if (!exam.domains.has(problem.domain)) {
        errors.push(`${file.name}: problems[${i}].domain: 資格マスタの分野にない分野です`);
      }
      if (exam.idPrefix !== undefined && !problem.id.startsWith(`${exam.idPrefix}-CD-`)) {
        errors.push(`${file.name}: problems[${i}].id: 問題 ID の接頭辞が資格マスタと違います`);
      }
    });
  }
  return errors;
}
