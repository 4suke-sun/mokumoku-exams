import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";
import { LedgerError, type LedgerFile, ledgerPath, readLedger } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import { EXAM_CODE, ExamsFileSchema, hostAllowedForVendor, sourceUrlReason, validateDataSet } from "../contract.ts";
import {
  DecisionsError,
  type DecisionsFile,
  decisionsPath,
  draftDecision,
  readDecisions,
} from "../decisions/decisions.ts";
import {
  checkProvenance,
  checkRecheck,
  ProvenanceError,
  type ProvenanceFile,
  provenancePath,
  readProvenance,
  writeProvenance,
} from "../draft/provenance.ts";
import { assembleQuestion } from "../draft/schema.ts";
import { applyDraftDecisions, type DraftRecord, DraftsError, draftWorkDir, readDrafts } from "../draft/store.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { FactsError, type FactsFile, factsPath, readFacts } from "../facts/schema.ts";
import { type Output, report } from "../log.ts";
import { readExistingTexts } from "../plan/run.ts";
import { readSampling, SamplingError, samplingPath } from "../sampling/store.ts";
import { readAgentStamp } from "../shared/agents.ts";
import { isVerified } from "../verify/schema.ts";
import { criteriaAccepted } from "./criteria.ts";

/**
 * export コマンド: 人が承認し、来歴の検査を通った下書きを、data/questions.<コード>.json に追加する(ADR 0020)。
 * - 出典(references)は、来歴の出典の URL(許可ドメインの https、重ねない、10 件まで)と、台帳の出典の題(公式ページの `<title>`)。
 *   台帳に題がなければ、題なしで書き出して報告する(ADR 0020)
 * - 問題 ID は、資格マスタの idPrefix で、今の問題・非公開の問題・退役した ID・書き出し済みの来歴の ID を含めた最大の番号の次から採番する
 * - 書いたあとにデータの検査を通し、失敗したら書き出し前の内容に戻す
 * - 書き出した問題の ID を来歴に書き戻し、同じ下書きを再び書き出さない
 * - 差分レポートは作業用の置き場にだけ書く(本文・出典の本文・環境固有の値を載せない)
 */

export interface ExportOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  dryRun: boolean;
  output: Output;
}

const MAX_REFERENCES = 10;

/** 書き出しの対象を選ぶ。承認され、通過で、検証を通り(検証が保留でも、人が承認していれば通す)、来歴があり、来歴の検査を通り、まだ書き出していない下書き */
export function selectExportable(
  drafts: readonly DraftRecord[],
  decisions: DecisionsFile,
  provenance: ProvenanceFile,
  blockedDraftIds: ReadonlySet<string>,
  /** 抜き取りで確認しないと記録した下書きの ID。検証を通っていれば、承認なしで書き出してよい(人が却下したものは除く) */
  autoAccepted: ReadonlySet<string> = new Set(),
): { ready: DraftRecord[]; notApproved: number; unverified: number; blocked: number; exported: number } {
  let notApproved = 0;
  let unverified = 0;
  let blocked = 0;
  let exported = 0;
  const ready: DraftRecord[] = [];
  for (const d of drafts) {
    if (d.status !== "passed" || d.draft === null) continue;
    // 非公開の問題を書き直した下書きは、採番して足さない。公開への復帰(restore)が、元の ID のまま戻す(ADR 0023)
    if (d.rewriteOf !== undefined) continue;
    const entry = provenance.entries.find((e) => e.draftId === d.id);
    if (entry?.questionId !== undefined) {
      exported++;
      continue;
    }
    if (draftDecision(decisions, d.id) !== "approve" && !autoAccepted.has(d.id)) {
      notApproved++;
      continue;
    }
    // 承認なしで書き出せるのは、検証の判定が合格のものだけ(人の承認で通す検証の保留は、承認があるときだけ)
    if (!isVerified(d.verification, draftDecision(decisions, d.id))) {
      unverified++;
      continue;
    }
    if (entry === undefined || blockedDraftIds.has(d.id)) {
      blocked++;
      continue;
    }
    ready.push(d);
  }
  return { ready, notApproved, unverified, blocked, exported };
}

/**
 * 出典を、来歴から選ぶ。出典に使えない URL と、ベンダーに許されないホストを落とし、重ねず、10 件まで。
 * 題は、台帳の出典の題(公式ページの `<title>`)。台帳に題がなければ、題なしで返す(書き出しは止めない。報告で数える)。
 */
export function references(
  sources: readonly { url: string; title?: string }[],
  vendor: string,
): { url: string; title?: string }[] {
  const kept: { url: string; title?: string }[] = [];
  for (const { url, title } of sources) {
    if (sourceUrlReason(url) !== null) continue;
    if (!hostAllowedForVendor(new URL(url).hostname, vendor)) continue;
    if (!kept.some((k) => k.url === url)) kept.push(title === undefined ? { url } : { url, title });
    if (kept.length === MAX_REFERENCES) break;
  }
  return kept;
}

/** 番号の部分。`<接頭辞>-<4 桁>` の形で、接頭辞が違えば null */
function numberOf(id: string, prefix: string): number | null {
  const m = new RegExp(`^${prefix}-(\\d{4})$`).exec(id);
  return m ? Number(m[1]) : null;
}

/** 採番する。使用済みの番号(今の問題・退役・書き出し済み)の最大の次から、連番で count 件 */
export function allocateIds(prefix: string, used: readonly string[], count: number): string[] {
  const max = used.reduce((m, id) => Math.max(m, numberOf(id, prefix) ?? 0), 0);
  if (max + count > 9999) throw new Error("問題 ID の番号が 4 桁を超える");
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(max + i + 1).padStart(4, "0")}`);
}

/** Biome で JSON を整形する(既存の data/ のファイルと同じ整形にそろえる) */
export function formatJson(text: string, rootDir: string): string {
  const require = createRequire(import.meta.url);
  const biome = join(dirname(require.resolve("@biomejs/biome/package.json")), "bin", "biome");
  return execFileSync(
    process.execPath,
    [
      biome,
      "format",
      "--stdin-file-path=questions.json",
      "--indent-style=space",
      "--indent-width=2",
      "--line-width=120",
    ],
    // 問題データは 1MB を超えうる。既定の出力の上限(1MB)では、整形の出力が切れて失敗する
    { input: text, cwd: rootDir, encoding: "utf8", stdio: ["pipe", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 },
  );
}

export function runExport(options: ExportOptions): ExitCode {
  const { config, rootDir, examCode, dryRun, output } = options;
  if (!EXAM_CODE.test(examCode)) {
    report(output, "入力の誤り", "資格コードの形");
    return EXIT.inputError;
  }
  const examsPath = resolve(rootDir, config.examsFile);
  const examsRaw: unknown = JSON.parse(readFileSync(examsPath, "utf8"));
  const exams = ExamsFileSchema.safeParse(examsRaw);
  if (!exams.success) {
    report(output, "資格マスタの誤り", config.examsFile);
    return EXIT.inputError;
  }
  const exam = exams.data.exams.find((e) => e.examCode === examCode);
  if (exam === undefined || exam.status !== "published") {
    report(output, "入力の誤り", "公開中の資格ではない");
    return EXIT.inputError;
  }

  const work = resolve(rootDir, config.workDir);
  const paths = {
    facts: factsPath(resolve(rootDir, config.factsDir), examCode),
    ledger: ledgerPath(resolve(rootDir, config.ledgerDir), examCode),
    provenance: provenancePath(resolve(rootDir, config.provenanceDir), examCode),
    decisions: decisionsPath(resolve(rootDir, config.decisionsDir), examCode),
    drafts: join(draftWorkDir(work, examCode), "drafts.json"),
    questions: resolve(rootDir, dirname(config.examsFile), `questions.${examCode.toLowerCase()}.json`),
    report: join(work, "export", examCode.toLowerCase(), "report.md"),
  };
  let facts: FactsFile;
  let ledger: LedgerFile;
  let provenance: ProvenanceFile;
  let decisions: DecisionsFile;
  let drafts: DraftRecord[];
  try {
    facts = readFacts(paths.facts, examCode);
    ledger = readLedger(paths.ledger, examCode);
    provenance = readProvenance(paths.provenance, examCode);
    decisions = readDecisions(paths.decisions, examCode);
    drafts = applyDraftDecisions(readDrafts(paths.drafts, examCode), (id) => draftDecision(decisions, id)).file.drafts;
  } catch (error) {
    if (error instanceof FactsError) for (const p of error.paths) report(output, "事実カードの誤り", p);
    else if (error instanceof LedgerError) for (const p of error.paths) report(output, "台帳の誤り", p);
    else if (error instanceof ProvenanceError) for (const p of error.paths) report(output, "来歴の誤り", p);
    else if (error instanceof DecisionsError) for (const p of error.paths) report(output, "判断の記録の誤り", p);
    else if (error instanceof DraftsError) for (const p of error.paths) report(output, "下書きの誤り", p);
    else throw error;
    return EXIT.checkFailed;
  }

  // 来歴の検査(形と根拠、再検証の印、出典の状態)に落ちた下書きは、書き出さない
  const problems = [...checkProvenance(provenance, facts, exam.vendor), ...checkRecheck(provenance, ledger)];
  const blockedIds = new Set(problems.map((p) => p.draftId));
  // 抜き取りで確認しないと記録した下書きは、承認なしで書き出せる。記録のあとに検証役の定義が変わっていれば、その記録は使わない
  let sampling: ReturnType<typeof readSampling>;
  try {
    sampling = readSampling(samplingPath(resolve(rootDir, config.decisionsDir), examCode), examCode);
  } catch (error) {
    if (!(error instanceof SamplingError)) throw error;
    for (const p of error.paths) report(output, "抜き取りの記録の誤り", p);
    return EXIT.checkFailed;
  }
  const autoAccepted =
    sampling?.mode === "sample" &&
    sampling.evalDefinitionHash === readAgentStamp(rootDir, "question-verifier").definitionHash
      ? new Set(sampling.draft.notReviewed)
      : new Set<string>();
  // 基準を満たした下書きは、承認なしで書き出せる(設定 review.autoApprove に挙げた試験だけ)
  const published = readExistingTexts(config, rootDir, examCode);
  if (published === "invalid") {
    report(output, "問題データの誤り", `questions.${examCode.toLowerCase()}.json`);
    return EXIT.checkFailed;
  }
  const byCriteria = config.review.autoApprove.includes(examCode)
    ? criteriaAccepted({
        drafts,
        examCode,
        targets: config.plan.overrides[examCode]?.services,
        services: ledger.guide?.services ?? [],
        publishedTexts: published,
      })
    : new Set<string>();
  const selection = selectExportable(
    drafts,
    decisions,
    provenance,
    blockedIds,
    new Set([...autoAccepted, ...byCriteria]),
  );
  const criteriaUsed = selection.ready.filter(
    (d) => byCriteria.has(d.id) && draftDecision(decisions, d.id) !== "approve",
  ).length;

  const original = existsSync(paths.questions) ? readFileSync(paths.questions, "utf8") : null;
  const current = original === null ? { examCode, questions: [] as unknown[] } : JSON.parse(original);
  const currentIds: string[] = (current.questions as { questionId: string }[]).map((q) => q.questionId);
  // 非公開の問題(data/unpublished.<コード>.json)の ID も、使用済みにする(公開に戻すときに、ID が重ならないように)
  const unpublishedPath = join(dirname(paths.questions), `unpublished.${examCode.toLowerCase()}.json`);
  const unpublishedIds: string[] = existsSync(unpublishedPath)
    ? (
        (JSON.parse(readFileSync(unpublishedPath, "utf8")) as { entries?: { question?: { questionId?: string } }[] })
          .entries ?? []
      ).flatMap((e) => (typeof e.question?.questionId === "string" ? [e.question.questionId] : []))
    : [];
  const used = [
    ...currentIds,
    ...unpublishedIds,
    ...(exam.retiredQuestionIds ?? []),
    ...provenance.entries.flatMap((e) => (e.questionId !== undefined ? [e.questionId] : [])),
  ];
  const ids = allocateIds(exam.idPrefix, used, selection.ready.length);
  const added = selection.ready.map((d, i) => {
    const entry = provenance.entries.find((e) => e.draftId === d.id);
    const question = assembleQuestion(d.draft as NonNullable<DraftRecord["draft"]>, {
      examCode,
      domain: d.domain,
      difficulty: d.difficulty,
      references: references(
        (entry?.sources ?? []).flatMap((s) => {
          const source = ledger.sources.find((l) => l.url === s.url);
          return [{ url: s.url, ...(source?.title !== undefined ? { title: source.title } : {}) }];
        }),
        exam.vendor,
      ),
    }) as Record<string, unknown>;
    return { draftId: d.id, question: { ...question, questionId: ids[i] as string } };
  });

  report(
    output,
    "情報",
    `書き出し: 追加 ${added.length} 件、承認待ち ${selection.notApproved} 件、検証前・検証で止まった ${selection.unverified} 件、来歴の検査で止めた ${selection.blocked} 件、書き出し済み ${selection.exported} 件、追加のうち基準を満たして承認なし ${criteriaUsed} 件`,
  );
  // 台帳に題のない出典は、題なしで書き出す。あとで collect --titles で台帳に題を足し、export --titles で問題に足す
  const untitled = new Set(
    added.flatMap((a) =>
      ((a.question as { references?: { url: string; title?: string }[] }).references ?? []).flatMap((r) =>
        r.title === undefined ? [r.url] : [],
      ),
    ),
  );
  for (const url of untitled) report(output, "題が取れない出典", url);
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return EXIT.ok;
  }
  if (added.length === 0) return EXIT.ok;

  // 書き出し: 追加の分だけを足す(ほかの問題は変えない)。書いたあとにデータの検査を通し、失敗したら元に戻す
  const next = { ...current, questions: [...current.questions, ...added.map((a) => a.question)] };
  const text = formatJson(`${JSON.stringify(next, null, 2)}\n`, rootDir);
  const restore = () => {
    if (original === null) rmSync(paths.questions, { force: true });
    else writeFileSync(paths.questions, original);
  };
  let errors: ReturnType<typeof validateDataSet>;
  try {
    writeFileSync(paths.questions, text);
    const dataDir = dirname(paths.questions);
    const questionFiles = readdirSync(dataDir)
      .filter((f) => /^questions\..+\.json$/.test(f))
      .sort()
      .map((name) => ({ name, data: JSON.parse(readFileSync(join(dataDir, name), "utf8")) as unknown }));
    const unpublishedFiles = readdirSync(dataDir)
      .filter((f) => /^unpublished\..+\.json$/.test(f))
      .sort()
      .map((name) => ({ name, data: JSON.parse(readFileSync(join(dataDir, name), "utf8")) as unknown }));
    errors = validateDataSet(examsRaw, questionFiles, undefined, [], unpublishedFiles);
  } catch (error) {
    restore();
    throw error;
  }
  if (errors.length > 0) {
    restore();
    report(output, "データの検査の失敗", `${errors.length} 件(書き出しを取り消した)`);
    return EXIT.checkFailed;
  }

  // 来歴に、書き出した問題の ID を書き戻す。書き戻せなければ、data/ も元に戻す(次の書き出しで同じ下書きを重ねない)
  const idOf = new Map(added.map((a) => [a.draftId, a.question.questionId]));
  try {
    writeProvenance(paths.provenance, {
      ...provenance,
      entries: provenance.entries.map((e) => {
        const questionId = idOf.get(e.draftId);
        return questionId !== undefined ? { ...e, questionId } : e;
      }),
    });
  } catch (error) {
    restore();
    throw error;
  }

  // 差分レポート(作業用の置き場。コミットしない)
  mkdirSync(dirname(paths.report), { recursive: true });
  writeFileSync(paths.report, renderExportReport(examCode, added, provenance, drafts));
  report(output, "情報", `書き出した: ${relative(rootDir, paths.questions)}`);
  report(output, "レビューレポート", relative(rootDir, paths.report));
  return EXIT.ok;
}

/** 差分レポート。件数、分野別、来歴の要約、保留・不採用の件数と理由の種類だけを載せる */
export function renderExportReport(
  examCode: string,
  added: readonly { draftId: string; question: Record<string, unknown> }[],
  provenance: ProvenanceFile,
  drafts: readonly DraftRecord[],
): string {
  const count = (values: readonly string[]) => {
    const m = new Map<string, number>();
    for (const v of values) m.set(v, (m.get(v) ?? 0) + 1);
    return [...m].sort(([a], [b]) => (a < b ? -1 : 1));
  };
  const entries = added.flatMap((a) => provenance.entries.filter((e) => e.draftId === a.draftId));
  const facts = new Set(entries.flatMap((e) => e.factIds));
  const hosts = count(entries.flatMap((e) => e.sources.map((s) => new URL(s.url).hostname)));
  const held = drafts.filter((d) => d.status === "held");
  const rejected = drafts.filter((d) => d.status === "rejected");
  const reasonKinds = count([...held, ...rejected].flatMap((d) => d.reasons.map((r) => r.split(":")[0] as string)));
  const lines = [
    `# 書き出しの差分レポート(${examCode})`,
    "",
    `- 追加: ${added.length} 件`,
    ...count(added.map((a) => String(a.question.domain))).map(([d, n]) => `  - ${d}: ${n} 件`),
    `- 根拠にした事実カード: ${facts.size} 件`,
    "- 出典のドメイン別:",
    ...hosts.map(([h, n]) => `  - ${h}: ${n} 件`),
    `- 保留の下書き: ${held.length} 件、不採用の下書き: ${rejected.length} 件`,
    "- 保留・不採用の理由の種類:",
    ...reasonKinds.map(([r, n]) => `  - ${r}: ${n} 件`),
    "",
  ];
  return `${lines.join("\n")}\n`;
}
