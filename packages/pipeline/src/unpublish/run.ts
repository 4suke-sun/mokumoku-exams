import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { Config } from "../config.ts";
import { QuestionsFileSchema, UnpublishedFileSchema, validateDataSet } from "../contract.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { formatJson } from "../export/export.ts";
import { readCriteria } from "../judge/criteria.ts";
import { contentHash, inputFromQuestion } from "../judge/input.ts";
import { readJudgeResults } from "../judge/run.ts";
import { JUDGE_VERDICTS } from "../judge/schema.ts";
import { type Output, report } from "../log.ts";
import { readAgentStampOrReport } from "../shared/agents.ts";
import { prepareExam } from "../shared/exam.ts";
import { writeJson } from "../shared/fs.ts";
import { readJsonFile } from "../shared/request-flow.ts";

/**
 * unpublish コマンド: 判定の結果(judge)で、公開のままにしない問題を、公開の問題データから非公開のファイルへ移す(ADR 0022)。
 * - 公開のファイル(data/questions.<コード>.json)から取り除き、非公開のファイル(data/unpublished.<コード>.json)に、判定と理由を添えて足す。
 * - 判定が古い問題(問題の内容・判定の基準・判定役の定義が、判定のあとに変わったもの)と、カリキュラムの単元・段階・要約カードから参照されている問題は、移さない(報告する)。
 * - 公開の選択式の問題が、本番モードの出題数を下回る移し方は、何も書かずに止める。
 * - 書く前に、移したあとのデータ全体の検査を通し、失敗したら何も書かない。書き込みが途中で失敗したときは、2 つのファイルを元に戻す。
 *   移す作業は、作業ツリーの `data/` の変更として、PR の差分で確かめる。
 * モデルは呼ばない。出力は、問題の ID・件数・理由コードだけで、問題の本文は出さない。
 */

export interface UnpublishOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  dryRun: boolean;
  output: Output;
}

/** 件数の記録(作業用の置き場。コミットしない)。次の実行で、判定の件数の差を出すために残す */
interface Counts {
  publish: number;
  rewritable: number;
  unpublish: number;
  byReason: Record<string, number>;
}

interface MoveReport {
  examCode: string;
  judged: Counts;
  moved: { count: number; byVerdict: Record<string, number>; byReason: Record<string, number>; ids: string[] };
  skipped: { stale: string[]; referenced: string[] };
}

const countBy = (items: readonly string[]): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const item of items) out[item] = (out[item] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
};

const line = (counts: Record<string, number>): string => {
  const parts = Object.entries(counts).map(([k, n]) => `${k}=${n}`);
  return parts.length === 0 ? "なし" : parts.join(" ");
};

/** カリキュラムの単元・段階と、要約カードが参照する問題 ID(参照元の名前つき)。ファイルがなければ空 */
function referencesOf(dataDir: string, code: string): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const add = (id: unknown, source: string) => {
    if (typeof id !== "string") return;
    out.set(id, [...new Set([...(out.get(id) ?? []), source])]);
  };
  const read = (name: string): unknown => {
    const path = join(dataDir, name);
    return existsSync(path) ? readJsonFile(path) : undefined;
  };
  const curriculum = read(`curriculum.${code}.json`) as
    | { units?: { questionIds?: unknown; stages?: { questionIds?: unknown }[] }[] }
    | undefined;
  for (const unit of curriculum?.units ?? []) {
    // 単元の問題と、段階の確認問題の、どちらも参照とする(カリキュラムの検査が、どちらも問題データにあることを求める)
    const lists = [unit.questionIds, ...(unit.stages ?? []).map((stage) => stage.questionIds)];
    for (const ids of lists) for (const id of Array.isArray(ids) ? ids : []) add(id, "curriculum");
  }
  const summary = read(`summary.${code}.json`) as { cards?: { questionId?: unknown }[] } | undefined;
  for (const card of summary?.cards ?? []) add(card.questionId, "summary");
  return out;
}

function previousCounts(path: string): Counts | null {
  const raw = existsSync(path) ? (readJsonFile(path) as Partial<MoveReport> | undefined) : undefined;
  return raw?.judged ?? null;
}

export function runUnpublish(options: UnpublishOptions): ExitCode {
  const { config, rootDir, examCode, dryRun, output } = options;
  const exam = prepareExam(options, { production: true });
  if (!exam.ok) return exam.exit;
  const code = examCode.toLowerCase();
  const dataDir = resolve(rootDir, dirname(config.examsFile));
  const judgeDir = join(resolve(rootDir, config.workDir), "judge", code);
  const paths = {
    questions: join(dataDir, `questions.${code}.json`),
    unpublished: join(dataDir, `unpublished.${code}.json`),
    results: join(judgeDir, "results.json"),
    report: join(judgeDir, "unpublish-report.json"),
  };
  if (!existsSync(paths.questions)) {
    report(output, "入力の誤り", "問題データがない");
    return EXIT.inputError;
  }
  if (!existsSync(paths.results)) {
    report(output, "入力の誤り", "判定の結果がない(先に judge を実行して取り込む)");
    return EXIT.inputError;
  }
  const criteria = readCriteria(rootDir, examCode);
  if (criteria === null) {
    report(output, "入力の誤り", "判定の基準がない(資格別の文書に「判定の基準」の節がない)");
    return EXIT.inputError;
  }
  const stamp = readAgentStampOrReport(output, rootDir, "question-judge");
  if (stamp === null) return EXIT.checkFailed;
  const published = QuestionsFileSchema.safeParse(readJsonFile(paths.questions));
  if (!published.success) {
    report(output, "問題データの誤り", relative(rootDir, paths.questions));
    return EXIT.inputError;
  }
  const existingRaw = existsSync(paths.unpublished) ? readJsonFile(paths.unpublished) : undefined;
  const existing = existingRaw === undefined ? null : UnpublishedFileSchema.safeParse(existingRaw);
  if (existing !== null && !existing.success) {
    report(output, "問題データの誤り", relative(rootDir, paths.unpublished));
    return EXIT.inputError;
  }
  const judged = readJudgeResults(paths.results, examCode);
  if (judged === null) {
    report(output, "入力の誤り", "判定の結果が読めない");
    return EXIT.inputError;
  }

  const questions = published.data.questions;
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  const references = referencesOf(dataDir, code);
  const stale: string[] = [];
  const referenced: string[] = [];
  const toMove: { id: string; verdict: "rewritable" | "unpublish"; reasons: string[] }[] = [];
  // 判定の件数。公開の問題に結果がある分だけ数える(消えた問題の結果は数えない)
  const counts: Counts = { publish: 0, rewritable: 0, unpublish: 0, byReason: {} };
  const reasonList: string[] = [];
  for (const entry of judged.entries) {
    const question = byId.get(entry.questionId);
    if (question === undefined) continue;
    const input = inputFromQuestion(question);
    if (
      input === null ||
      contentHash(input) !== entry.contentHash ||
      entry.criteriaHash !== criteria.hash ||
      entry.agent.definitionHash !== stamp.definitionHash
    ) {
      stale.push(entry.questionId);
      continue;
    }
    counts[entry.verdict]++;
    reasonList.push(...entry.reasons);
    if (entry.verdict === "publish") continue;
    if (references.has(entry.questionId)) {
      referenced.push(entry.questionId);
      continue;
    }
    toMove.push({ id: entry.questionId, verdict: entry.verdict, reasons: entry.reasons });
  }
  counts.byReason = countBy(reasonList);
  toMove.sort((a, b) => (a.id < b.id ? -1 : 1));

  const choiceTotal = questions.filter((q) => q.questionType !== "free-text").length;
  const afterFloor = choiceTotal - toMove.length;
  const floor = exam.master.officialQuestionCount;
  report(
    output,
    "非公開への移動",
    `判定 ${JUDGE_VERDICTS.map((v) => `${v}=${counts[v]}`).join(" ")}、移す ${toMove.length} 問、判定が古くて移さない ${stale.length} 問、参照があって移さない ${referenced.length} 問`,
  );
  report(output, "非公開への移動", `理由コード(判定の問数): ${line(counts.byReason)}`);
  const movedByReason = countBy(toMove.flatMap((m) => m.reasons));
  report(output, "非公開への移動", `移す問題の理由コード: ${line(movedByReason)}`);
  for (const id of referenced) {
    report(output, "非公開に移さない", `${id} 参照 ${(references.get(id) ?? []).join(",")}`);
  }
  reportDifference(output, previousCounts(paths.report), counts);
  report(output, "非公開への移動", `公開の選択式 ${choiceTotal} 問 → ${afterFloor} 問(本番モードの出題数 ${floor} 問)`);
  if (afterFloor < floor) {
    report(output, "出題の下限", `移すと公開の選択式が ${floor - afterFloor} 問足りない(何も書かない)`);
    return EXIT.checkFailed;
  }
  if (toMove.length === 0) return EXIT.ok;

  const movedIds = new Set(toMove.map((m) => m.id));
  const nextPublished = { ...published.data, questions: questions.filter((q) => !movedIds.has(q.questionId)) };
  const added = toMove.map((m) => ({ verdict: m.verdict, reasons: m.reasons, question: byId.get(m.id) }));
  const entries = [...(existing?.success ? existing.data.entries : []), ...added]
    .filter((e) => e.question !== undefined)
    .sort((a, b) => ((a.question?.questionId ?? "") < (b.question?.questionId ?? "") ? -1 : 1));
  const nextUnpublished = { examCode, entries };

  // 書く前に、データ全体の検査を通す(失敗したら何も書かない)
  const examsRaw = readJsonFile(resolve(rootDir, config.examsFile));
  const readAll = (pattern: RegExp, replaceName: string, replacement: unknown) =>
    readdirSync(dataDir)
      .filter((f) => pattern.test(f))
      .sort()
      .map((name) => ({
        name,
        data: name === replaceName ? replacement : (readJsonFile(join(dataDir, name)) as unknown),
      }));
  const questionFiles = readAll(/^questions\..+\.json$/, `questions.${code}.json`, nextPublished);
  const unpublishedFiles = readAll(/^unpublished\..+\.json$/, `unpublished.${code}.json`, nextUnpublished);
  if (!unpublishedFiles.some((f) => f.name === `unpublished.${code}.json`)) {
    unpublishedFiles.push({ name: `unpublished.${code}.json`, data: nextUnpublished });
  }
  const errors = validateDataSet(examsRaw, questionFiles, undefined, [], unpublishedFiles);
  if (errors.length > 0) {
    report(output, "データの検査の失敗", `${errors.length} 件(何も書かなかった)`);
    return EXIT.checkFailed;
  }

  const moveReport: MoveReport = {
    examCode,
    judged: counts,
    moved: {
      count: toMove.length,
      byVerdict: countBy(toMove.map((m) => m.verdict)),
      byReason: movedByReason,
      ids: toMove.map((m) => m.id),
    },
    skipped: { stale: stale.sort(), referenced: referenced.sort() },
  };
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return EXIT.ok;
  }
  const originalPublished = readFileSync(paths.questions, "utf8");
  const originalUnpublished = existsSync(paths.unpublished) ? readFileSync(paths.unpublished, "utf8") : null;
  try {
    writeFileSync(paths.unpublished, formatJson(`${JSON.stringify(nextUnpublished, null, 2)}\n`, rootDir));
    writeFileSync(paths.questions, formatJson(`${JSON.stringify(nextPublished, null, 2)}\n`, rootDir));
  } catch (error) {
    writeFileSync(paths.questions, originalPublished);
    if (originalUnpublished === null) rmSync(paths.unpublished, { force: true });
    else writeFileSync(paths.unpublished, originalUnpublished);
    throw error;
  }
  mkdirSync(judgeDir, { recursive: true });
  writeJson(paths.report, moveReport);
  report(
    output,
    "情報",
    `移した: ${relative(rootDir, paths.unpublished)}(公開の問題は ${relative(rootDir, paths.questions)})`,
  );
  return EXIT.ok;
}

/** 前回の移動のときの判定の件数との差(基準や判定役を変えたときに、判定が動いたかを見る)。前回の記録がなければ、その旨だけ */
function reportDifference(output: Output, previous: Counts | null, now: Counts): void {
  if (previous === null) {
    report(output, "非公開への移動", "判定の件数の差: 前回の記録がない");
    return;
  }
  const signed = (n: number) => (n > 0 ? `+${n}` : String(n));
  const verdicts = JUDGE_VERDICTS.map((v) => `${v} ${signed(now[v] - previous[v])}`).join(" ");
  const reasons = [...new Set([...Object.keys(previous.byReason), ...Object.keys(now.byReason)])]
    .sort()
    .map((r) => [r, (now.byReason[r] ?? 0) - (previous.byReason[r] ?? 0)] as const)
    .filter(([, d]) => d !== 0)
    .map(([r, d]) => `${r} ${signed(d)}`);
  report(
    output,
    "非公開への移動",
    `判定の件数の差(前回の移動との差): ${verdicts}、理由コード ${reasons.length === 0 ? "変化なし" : reasons.join(" ")}`,
  );
}
