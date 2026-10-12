/**
 * 要約カードのデータの検査: 各ファイルのスキーマの検査と、資格マスタ・問題データとの照合。
 * 純粋な関数にして単体テストする(ファイルの読み込みは scripts/validate-summary-data.ts)。
 * 報告は、場所(ファイル、項目の位置)と種類だけにする。入力の値は含めない。
 */
import type { DataFile } from "../exam-data/validate.ts";
import { formatIssues } from "../exam-data/validate.ts";
import { SummaryFileSchema } from "./schema.ts";

const SUMMARY_FILE = /^summary\.([a-z][a-z0-9]{1,15})\.json$/;

/** 問題の情報: 択一・複数選択は正解のキーの並び。自由記述は null(要約カードは作れない) */
export type QuestionAnswers = ReadonlyMap<string, readonly string[] | null>;

type Context = {
  /** 公開中の資格ごとの、問題データにある問題 */
  questions: ReadonlyMap<string, QuestionAnswers>;
};

const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && a.every((key) => b.includes(key));

export function validateSummaryData(files: DataFile[], { questions }: Context): string[] {
  const errors: string[] = [];
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const match = SUMMARY_FILE.exec(file.name);
    if (!match?.[1]) {
      errors.push(`${file.name}: ファイル名が summary.<コード(英小文字と数字)>.json の形ではありません`);
      continue;
    }
    const code = match[1].toUpperCase();

    const parsed = SummaryFileSchema.safeParse(file.data);
    if (!parsed.success) {
      errors.push(...formatIssues(file.name, parsed.error, file.data));
      continue;
    }
    if (parsed.data.examCode !== code) {
      errors.push(`${file.name}: examCode がファイル名のコードと一致しません`);
      continue;
    }
    const known = questions.get(code);
    if (!known) {
      errors.push(`${file.name}: 公開中の資格(問題データのある資格)の要約カードではありません`);
      continue;
    }
    parsed.data.cards.forEach((card, i) => {
      const correct = known.get(card.questionId);
      if (correct === undefined) {
        errors.push(`${file.name}: cards[${i}].questionId: 問題データにない問題です`);
      } else if (correct === null) {
        errors.push(`${file.name}: cards[${i}].questionId: 選択式の問題ではありません`);
      } else if (!sameSet(card.answers, correct)) {
        errors.push(`${file.name}: cards[${i}].answers: 問題の正解と一致しません`);
      }
    });
  }
  return errors;
}
