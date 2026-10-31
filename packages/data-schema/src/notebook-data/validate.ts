/**
 * 体系ノートのデータの検査: 各ファイルのスキーマの検査と、資格マスタとの照合。
 * 純粋な関数にして単体テストする(ファイルの読み込みは scripts/validate-notebook-data.ts)。
 * 報告は、場所(ファイル、項目の位置)と種類だけにする。入力の値は含めない。
 */
import type { DataFile } from "../exam-data/validate.ts";
import { formatIssues } from "../exam-data/validate.ts";
import { NotebookFileSchema } from "./schema.ts";

const NOTEBOOK_FILE = /^notebook\.([a-z][a-z0-9]{1,5}-[a-z][a-z0-9]{1,9}-[a-z0-9]{2,4})\.json$/;

type Context = {
  /** 公開中の資格ごとの、資格マスタの分野のコード */
  domains: ReadonlyMap<string, ReadonlySet<string>>;
};

export function validateNotebookData(files: DataFile[], { domains }: Context): string[] {
  const errors: string[] = [];
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const match = NOTEBOOK_FILE.exec(file.name);
    if (!match?.[1]) {
      errors.push(`${file.name}: ファイル名が notebook.<コード(英小文字と数字)>.json の形ではありません`);
      continue;
    }
    const code = match[1].toUpperCase();

    const parsed = NotebookFileSchema.safeParse(file.data);
    if (!parsed.success) {
      errors.push(...formatIssues(file.name, parsed.error, file.data));
      continue;
    }
    if (parsed.data.examCode !== code) {
      errors.push(`${file.name}: examCode がファイル名のコードと一致しません`);
      continue;
    }
    const masterDomains = domains.get(code);
    if (!masterDomains) {
      errors.push(`${file.name}: 公開中の資格の体系ノートではありません`);
      continue;
    }
    parsed.data.units.forEach((unit, i) => {
      if (!masterDomains.has(unit.domain)) {
        errors.push(`${file.name}: units[${i}].domain: 資格マスタの分野にない分野です`);
      }
    });
  }
  return errors;
}
