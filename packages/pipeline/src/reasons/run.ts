import { join, relative, resolve } from "node:path";
import type { Config } from "../config.ts";
import { DecisionsError, decisionsPath, readDecisions } from "../decisions/decisions.ts";
import { DraftsError, draftWorkDir, readDrafts } from "../draft/store.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { FactsError, factsPath, readFacts } from "../facts/schema.ts";
import { type Output, report } from "../log.ts";
import { prepareExam } from "../shared/exam.ts";
import { writeFileAtomic, writeJson } from "../shared/fs.ts";
import { aggregate, renderSummary } from "./aggregate.ts";

/**
 * reasons コマンド: 不採用と差し戻しの理由を集計し、下書きの指示の改善に使える形で書き出す。
 * 入力は、事実カードと下書きの判定の記録と、人の判断の記録。読むだけで、data/ もコミットする台帳も変えない。
 * 結果は、作業用の置き場(pipeline-work/reasons/<コード>/)に書く。下書きの指示を直す人が、読んで判断できる。
 */

export interface ReasonsOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  dryRun: boolean;
  output: Output;
}

export function runReasons(options: ReasonsOptions): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
  const exam = prepareExam(options);
  if (!exam.ok) return exam.exit;
  const work = resolve(rootDir, config.workDir);
  let summary: ReturnType<typeof aggregate>;
  try {
    const facts = readFacts(factsPath(resolve(rootDir, config.factsDir), examCode), examCode);
    const drafts = readDrafts(join(draftWorkDir(work, examCode), "drafts.json"), examCode);
    const decisions = readDecisions(decisionsPath(resolve(rootDir, config.decisionsDir), examCode), examCode);
    summary = aggregate(examCode, facts, drafts, decisions);
  } catch (error) {
    if (error instanceof FactsError) for (const p of error.paths) report(output, "事実カードの誤り", p);
    else if (error instanceof DraftsError) for (const p of error.paths) report(output, "下書きの誤り", p);
    else if (error instanceof DecisionsError) for (const p of error.paths) report(output, "判断の記録の誤り", p);
    else throw error;
    return EXIT.checkFailed;
  }
  for (const s of summary.stages) {
    report(
      output,
      "理由の集計",
      `段階 ${s.stage} 件数 ${s.total} 通過 ${s.passed} 保留 ${s.held} 不採用 ${s.rejected}`,
    );
  }
  for (const r of summary.reasons) {
    report(output, "理由の集計", `理由 ${r.stage} ${r.code} ${r.count} 件 ${(r.ratio * 100).toFixed(1)}%`);
  }
  if (summary.reasons.length === 0) report(output, "情報", "保留・不採用・差し戻しの理由はない(空の集計)");
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return EXIT.ok;
  }
  const dir = join(work, "reasons", examCode.toLowerCase());
  writeJson(join(dir, "summary.json"), summary);
  writeFileAtomic(join(dir, "summary.md"), renderSummary(summary));
  report(output, "レビューレポート", relative(rootDir, join(dir, "summary.md")));
  report(output, "レビューレポート", relative(rootDir, join(dir, "summary.json")));
  return EXIT.ok;
}
