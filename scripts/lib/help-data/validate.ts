/**
 * 使い方ページのデータの検査: スキーマの検査と、リンク先の確認(リンク切れ)。
 * 純粋な関数にして単体テストする(ファイルの読み込みは scripts/validate-help-data.ts)。
 * 報告は、場所と種類だけにする。入力の値は含めない。
 */
import { formatIssues } from "../exam-data/validate.ts";
import { HelpFileSchema } from "./schema.ts";

export const HELP_FILE = "help.json";

type Context = {
  /** リンク先にできる、アプリ内のパス(ホーム、資格の一覧など、画面ができているもの) */
  routes: readonly string[];
  /** 公開中の資格コード(`/exams/<コード>` へのリンクを許可する) */
  examCodes: readonly string[];
};

function isKnownRoute(path: string, { routes, examCodes }: Context): boolean {
  if (routes.includes(path)) return true;
  const match = /^\/exams\/([A-Z0-9]+)$/.exec(path);
  return match !== null && examCodes.includes(match[1] as string);
}

export function validateHelpData(data: unknown, context: Context): string[] {
  if (data === null || data === undefined) return [`${HELP_FILE}: ファイルがありません`];
  const parsed = HelpFileSchema.safeParse(data);
  if (!parsed.success) return formatIssues(HELP_FILE, parsed.error, data);

  const errors: string[] = [];
  parsed.data.sections.forEach((section, i) => {
    section.links?.forEach((link, j) => {
      if (link.href.startsWith("/") && !isKnownRoute(link.href, context)) {
        errors.push(`${HELP_FILE}: sections[${i}].links[${j}].href: リンク先の画面がありません(リンク切れ)`);
      }
    });
  });
  return errors;
}
