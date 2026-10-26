import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { LedgerError, ledgerPath, readLedger } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import { EXAM_CODE, ReferenceTitle, validateDataSet } from "../contract.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { type Output, report } from "../log.ts";
import { formatJson } from "./export.ts";

type Reference = { url: string; title?: string };
type QuestionLike = { references?: Reference[] };

/**
 * 題のない出典に、題を足す。同じ URL の題は 1 つにそろえる。
 * 使う題は、データにすでにある同じ URL の題(最初に見つかったもの)、なければ台帳の題。どちらもなければ足さない。
 * 戻り値は、足した件数と、題が取れなかった URL(重ねない)。
 */
export function fillReferenceTitles(
  questions: QuestionLike[],
  ledgerTitles: ReadonlyMap<string, string>,
): { added: number; missing: string[] } {
  const known = new Map<string, string>();
  for (const q of questions) {
    for (const r of q.references ?? []) {
      if (r.title !== undefined && !known.has(r.url)) known.set(r.url, r.title);
    }
  }
  let added = 0;
  const missing = new Set<string>();
  for (const q of questions) {
    for (const r of q.references ?? []) {
      if (r.title !== undefined) continue;
      const title = known.get(r.url) ?? ledgerTitles.get(r.url);
      if (title === undefined || !ReferenceTitle.safeParse(title).success) {
        missing.add(r.url);
        continue;
      }
      r.title = title;
      added++;
    }
  }
  return { added, missing: [...missing] };
}

export interface FillTitlesOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  dryRun: boolean;
  output: Output;
}

/** export --titles: 公開している問題の、題のない出典に題を足す。ほかの項目は変えない。 */
export function runFillTitles(options: FillTitlesOptions): ExitCode {
  const { config, rootDir, examCode, dryRun, output } = options;
  if (!EXAM_CODE.test(examCode)) {
    report(output, "入力の誤り", "資格コードの形");
    return EXIT.inputError;
  }
  const questionsPath = resolve(rootDir, dirname(config.examsFile), `questions.${examCode.toLowerCase()}.json`);
  let data: { questions: QuestionLike[] };
  try {
    data = JSON.parse(readFileSync(questionsPath, "utf8"));
  } catch {
    report(output, "問題データの誤り", `questions.${examCode.toLowerCase()}.json`);
    return EXIT.checkFailed;
  }
  let titles: Map<string, string>;
  try {
    const ledger = readLedger(ledgerPath(resolve(rootDir, config.ledgerDir), examCode), examCode);
    titles = new Map(ledger.sources.flatMap((s) => (s.title !== undefined ? [[s.url, s.title] as const] : [])));
  } catch (error) {
    if (!(error instanceof LedgerError)) throw error;
    for (const p of error.paths) report(output, "台帳の誤り", p);
    return EXIT.checkFailed;
  }
  const { added, missing } = fillReferenceTitles(data.questions, titles);
  for (const url of missing) report(output, "題が取れない出典", url);
  report(output, "情報", `題を足した出典 ${added} 件、題が取れない URL ${missing.length} 件`);
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return EXIT.ok;
  }
  let examsRaw: unknown;
  try {
    examsRaw = JSON.parse(readFileSync(resolve(rootDir, config.examsFile), "utf8"));
  } catch {
    report(output, "資格マスタの誤り", config.examsFile);
    return EXIT.inputError;
  }
  if (added > 0) {
    // 書いたあとにデータの検査を通し、失敗したら元に戻す(export と同じ)
    const original = readFileSync(questionsPath, "utf8");
    const dataDir = dirname(questionsPath);
    try {
      writeFileSync(questionsPath, formatJson(`${JSON.stringify(data, null, 2)}\n`, rootDir));
      const questionFiles = readdirSync(dataDir)
        .filter((f) => /^questions\..+\.json$/.test(f))
        .sort()
        .map((name) => ({ name, data: JSON.parse(readFileSync(join(dataDir, name), "utf8")) as unknown }));
      const errors = validateDataSet(examsRaw, questionFiles);
      if (errors.length > 0) {
        writeFileSync(questionsPath, original);
        report(output, "データの検査の失敗", `${errors.length} 件(書き込みを取り消した)`);
        return EXIT.checkFailed;
      }
    } catch (error) {
      writeFileSync(questionsPath, original);
      throw error;
    }
  }
  return missing.length > 0 ? EXIT.checkFailed : EXIT.ok;
}
