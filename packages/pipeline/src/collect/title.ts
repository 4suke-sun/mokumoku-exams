import { resolve } from "node:path";
import type { Config } from "../config.ts";
import { ReferenceTitle } from "../contract.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { type Output, report } from "../log.ts";
import { prepareExam } from "../shared/exam.ts";
import type { CollectDeps } from "./collect.ts";
import { extractTitle } from "./html.ts";
import { LedgerError, ledgerPath, readLedger, type SourceEntry, writeLedger } from "./ledger.ts";

/** ページの題。データの契約の出典の題の規則(空白だけでない、URL を含まない、長さの上限)に通らなければ null。 */
export function pageTitle(html: string): string | null {
  const title = extractTitle(html);
  return title !== null && ReferenceTitle.safeParse(title).success ? title : null;
}

/** 台帳の出典に付ける題の項目。取れたら新しい題、取れなければ前の題を残す(なければ項目を付けない) */
export function titleField(html: string | null, previous: string | undefined): { title?: string } {
  const title = html === null ? null : pageTitle(html);
  const value = title ?? previous;
  return value === undefined ? {} : { title: value };
}

export interface TitlesOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  dryRun: boolean;
  output: Output;
  deps: CollectDeps;
}

/**
 * collect --titles: 題のない台帳の出典だけを取得し、題を足す。本文のハッシュ・取得日・状態・検査の記録は変えない。
 * 1 回の実行で取得する件数は、設定 maxItemsPerRun まで(再実行で続きから進む)。
 */
export async function runTitles(options: TitlesOptions): Promise<ExitCode> {
  const { config, rootDir, examCode, dryRun, output, deps } = options;
  const exam = prepareExam(options);
  if (!exam.ok) return exam.exit;
  const path = ledgerPath(resolve(rootDir, config.ledgerDir), examCode);
  let ledger: ReturnType<typeof readLedger>;
  try {
    ledger = readLedger(path, examCode);
  } catch (error) {
    if (!(error instanceof LedgerError)) throw error;
    for (const p of error.paths) report(output, "台帳の誤り", p);
    return EXIT.checkFailed;
  }
  const missing = ledger.sources.filter((s) => s.title === undefined);
  report(output, "情報", `題のない出典 ${missing.length} 件(台帳 ${ledger.sources.length} 件)`);
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return EXIT.ok;
  }
  const titles = new Map<string, string>();
  let attempted = 0;
  let failed = 0;
  for (const source of missing) {
    if (attempted >= config.maxItemsPerRun) break;
    attempted++;
    const fetched = await deps.fetcher.get(source.url);
    const title = fetched.ok ? pageTitle(fetched.body.toString("utf8")) : null;
    if (title === null) {
      failed++;
      report(output, "題が取れない出典", source.url);
    } else {
      titles.set(source.url, title);
    }
  }
  if (titles.size > 0) {
    const sources: SourceEntry[] = ledger.sources.map((s) => {
      const title = titles.get(s.url);
      return title === undefined ? s : { ...s, title };
    });
    writeLedger(path, { ...ledger, sources });
  }
  const left = missing.length - titles.size;
  report(output, "情報", `題を足した出典 ${titles.size} 件、取れなかった ${failed} 件、残り ${left} 件`);
  if (attempted < missing.length) report(output, "件数の上限", "maxItemsPerRun(再実行で続きから進む)");
  return left > 0 ? EXIT.checkFailed : EXIT.ok;
}
