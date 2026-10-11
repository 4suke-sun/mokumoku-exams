/**
 * カリキュラムのデータの検査: 各ファイルのスキーマの検査と、資格マスタ・問題データとの照合。
 * 純粋な関数にして単体テストする(ファイルの読み込みは scripts/validate-curriculum-data.ts)。
 * 報告は、場所(ファイル、項目の位置)と種類だけにする。入力の値は含めない。
 */
import type { DataFile } from "../exam-data/validate.ts";
import { formatIssues } from "../exam-data/validate.ts";
import { CurriculumFileSchema } from "./schema.ts";

const CURRICULUM_FILE = /^curriculum\.([a-z][a-z0-9]{1,15})\.json$/;

type Context = {
  /** 公開中の資格ごとの、問題データにある問題 ID */
  questionIds: ReadonlyMap<string, ReadonlySet<string>>;
};

export function validateCurriculumData(files: DataFile[], { questionIds }: Context): string[] {
  const errors: string[] = [];
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const match = CURRICULUM_FILE.exec(file.name);
    if (!match?.[1]) {
      errors.push(`${file.name}: ファイル名が curriculum.<コード(英小文字と数字)>.json の形ではありません`);
      continue;
    }
    const code = match[1].toUpperCase();

    const parsed = CurriculumFileSchema.safeParse(file.data);
    if (!parsed.success) {
      errors.push(...formatIssues(file.name, parsed.error, file.data));
      continue;
    }
    if (parsed.data.examCode !== code) {
      errors.push(`${file.name}: examCode がファイル名のコードと一致しません`);
      continue;
    }
    const known = questionIds.get(code);
    if (!known) {
      errors.push(`${file.name}: 公開中の資格(問題データのある資格)のカリキュラムではありません`);
      continue;
    }
    parsed.data.units.forEach((unit, i) => {
      unit.questionIds.forEach((id, j) => {
        if (!known.has(id)) {
          errors.push(`${file.name}: units[${i}].questionIds[${j}]: 問題データにない問題です`);
        }
      });
      unit.stages?.forEach((stage, k) => {
        stage.questionIds.forEach((id, j) => {
          if (!known.has(id)) {
            errors.push(`${file.name}: units[${i}].stages[${k}].questionIds[${j}]: 問題データにない問題です`);
          }
        });
      });
    });
  }
  return errors;
}
