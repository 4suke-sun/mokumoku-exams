import { existsSync, readFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { Config } from "../config.ts";
import {
  DecisionsError,
  type DecisionsFile,
  decisionsPath,
  orphanDecisions,
  readDecisions,
  sourceAccepted,
} from "../decisions/decisions.ts";
import { ProvenanceError, provenancePath, readProvenance } from "../draft/provenance.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { FactsError, factsPath, readFacts } from "../facts/schema.ts";
import { type Output, report } from "../log.ts";
import { type AgentStamp, readAgentStampOrReport, sameDefinition } from "../shared/agents.ts";
import { prepareExam } from "../shared/exam.ts";
import { writeJson } from "../shared/fs.ts";
import { definitionChanged, discardStale, type FlowContext, readJsonFile, reportStop } from "../shared/request-flow.ts";
import { BodyCache } from "./cache.ts";
import {
  type Affected,
  type ChangeReport,
  detectChanges,
  markRecheck,
  type Observation,
  traceAffected,
} from "./changes.ts";
import { type ExamInfo, runChecks, statusFromChecks } from "./checks.ts";
import type { FetchResult } from "./fetcher.ts";
import { diffWithMaster, type GuideRequest, importGuide, type MasterExamValues } from "./guide.ts";
import { extractLinks, extractUpdatedDate } from "./html.ts";
import {
  LedgerError,
  type LedgerFile,
  ledgerPath,
  readLedger,
  type SourceEntry,
  type SourceKind,
  writeLedger,
} from "./ledger.ts";
import { inScope, loadPlan, type Plan, planPath } from "./plan.ts";
import { titleField } from "./title.ts";

/**
 * collect コマンド: 計画に沿って、取得、キャッシュ、台帳の更新、検査を順に行う。
 * 台帳は 1 件ごとに書くので、途中で止まっても、再実行すると今日取得済みのものを飛ばして続きから進む。
 */

export interface CollectDeps {
  fetcher: { get(url: string): Promise<FetchResult> };
  /** 今日の日付(YYYY-MM-DD) */
  today(): string;
  now(): number;
}

export interface CollectOptions {
  config: Config;
  /** リポジトリ直下。設定のパスは、ここからの相対パス */
  rootDir: string;
  examCode: string;
  dryRun: boolean;
  importGuide: boolean;
  output: Output;
  deps: CollectDeps;
}

interface Paths {
  ledger: string;
  plan: string;
  cacheDir: string;
  guideDir: string;
  reportFile: string;
}

function pathsFor(config: Config, rootDir: string, examCode: string): Paths {
  const code = examCode.toLowerCase();
  const work = resolve(rootDir, config.workDir);
  return {
    ledger: ledgerPath(resolve(rootDir, config.ledgerDir), examCode),
    plan: planPath(resolve(rootDir, config.plansDir), examCode),
    cacheDir: join(work, "cache"),
    guideDir: join(work, "guide"),
    reportFile: join(work, "collect", code, "report.json"),
  };
}

export async function runCollect(options: CollectOptions): Promise<ExitCode> {
  const { config, rootDir, examCode, output } = options;
  const exam = prepareExam(options);
  if (!exam.ok) return exam.exit;
  const master = exam.master;
  const paths = pathsFor(config, rootDir, examCode);
  let ledger: LedgerFile;
  try {
    ledger = readLedger(paths.ledger, examCode);
  } catch (error) {
    if (!(error instanceof LedgerError)) throw error;
    for (const p of error.paths) report(output, "台帳の誤り", p);
    return EXIT.checkFailed;
  }
  return options.importGuide
    ? importGuideStep(options, paths, ledger, master.domains, master.examValues)
    : collectStep(options, paths, ledger, master.exam);
}

async function collectStep(
  options: CollectOptions,
  paths: Paths,
  initial: LedgerFile,
  exam: ExamInfo,
): Promise<ExitCode> {
  const { config, rootDir, examCode, output, deps, dryRun } = options;
  const { plan, problems } = loadPlan(paths.plan, examCode);
  if (plan === null) {
    for (const p of problems) report(output, "計画の誤り", `${p.path} ${p.reason}`);
    return EXIT.checkFailed;
  }
  if (dryRun) {
    report(
      output,
      "情報",
      `計画の検査: 誤りなし(収集を始める URL ${plan.sources.length} 件、深さ ${plan.scope.maxDepth})`,
    );
    report(output, "書き込みをしない(dry-run)");
    return EXIT.ok;
  }
  const stamp = readAgentStampOrReport(output, rootDir, "guide-extractor");
  if (stamp === null) return EXIT.checkFailed;

  // 事実カードの根拠にした出典。本文が変わったら、そのカードに再検証の印を付ける
  const factSources: Record<string, string[]> = {};
  try {
    const facts = readFacts(factsPath(resolve(rootDir, config.factsDir), examCode), examCode);
    for (const card of facts.cards) {
      if (card.status !== "rejected") factSources[card.id] = card.sources.map((s) => s.url);
    }
  } catch (error) {
    if (!(error instanceof FactsError)) throw error;
    for (const p of error.paths) report(output, "事実カードの誤り", p);
    return EXIT.checkFailed;
  }

  // 人の判断の記録(日付が古いだけで止まった出典の受け入れ)
  let decisions: DecisionsFile;
  try {
    decisions = readDecisions(decisionsPath(resolve(rootDir, config.decisionsDir), examCode), examCode);
  } catch (error) {
    if (!(error instanceof DecisionsError)) throw error;
    for (const p of error.paths) report(output, "判断の記録の誤り", p);
    return EXIT.checkFailed;
  }

  // 来歴(下書き・問題 → 事実カード)。変化した出典を根拠にした下書き・問題を洗い出し、件数を報告する。
  // 下書き・問題には印を持たせず、先の段階(来歴の検査)が、来歴と台帳の今の状態を比べて止める
  const provenance: Record<string, readonly string[]> = {};
  try {
    const file = readProvenance(provenancePath(resolve(rootDir, config.provenanceDir), examCode), examCode);
    for (const e of file.entries) provenance[e.questionId ?? e.draftId] = e.factIds;
  } catch (error) {
    if (!(error instanceof ProvenanceError)) throw error;
    for (const p of error.paths) report(output, "来歴の誤り", p);
    return EXIT.checkFailed;
  }

  const today = deps.today();
  const cache = new BodyCache(paths.cacheDir, config.cache, deps.now);
  let ledger = initial;
  const changes: ChangeReport = { changed: [], unconfirmed: [] };
  const affected: Affected = { facts: [], questions: [] };
  // 出典の種別は、収集のたびに計画から付ける。試験ガイドの続きのページ(guidePages)と、試験ガイドのページからたどった付属のページは、
  // 試験ガイド(exam-guide)として扱う(事実カードの抽出の対象から外す)
  const kindOf = new Map<string, SourceKind>([
    ...(plan.guidePages ?? []).map((url): [string, SourceKind] => [url, "exam-guide"]),
    ...plan.sources.map((s): [string, SourceKind] => [s.url, s.kind]),
  ]);
  const starts = [...new Set([...plan.sources.map((s) => s.url), ...(plan.guidePages ?? [])])];
  const queue: { url: string; depth: number }[] = starts.map((url) => ({ url, depth: 0 }));
  const seen = new Set(starts);
  let fetchedCount = 0;
  let resumedCount = 0;
  let limited = false;

  while (queue.length > 0) {
    const { url, depth } = queue.shift() as { url: string; depth: number };
    const before = ledger.sources.find((s) => s.url === url);
    let body: Buffer | null = null;

    if (before?.fetchedAt === today && before.contentHash !== null && cache.has(before.contentHash)) {
      // 今日すでに取得したもの(途中で止まった実行の再開)。取り直さず、キャッシュの本文でリンクだけをたどる
      body = cache.read(before.contentHash);
      resumedCount++;
    } else {
      if (fetchedCount >= config.maxItemsPerRun) {
        limited = true;
        break;
      }
      fetchedCount++;
      const fetched = await deps.fetcher.get(url);
      const html = fetched.ok ? fetched.body.toString("utf8") : null;
      const updatedAt = fetched.ok ? extractUpdatedDate(html ?? "", fetched.lastModified) : (before?.updatedAt ?? null);
      const target: SourceEntry["target"] = {
        examCode,
        ...(exam.edition !== undefined ? { edition: exam.edition } : {}),
        ...(before?.target.region !== undefined ? { region: before.target.region } : {}),
      };
      const outcomes = runChecks({
        entry: { url, target },
        exam,
        ...(plan.regions !== undefined ? { regions: plan.regions } : {}),
        fetched,
        updatedAt,
        today,
        freshnessDays: config.checks.freshnessDays,
      });
      let status = statusFromChecks(outcomes);
      // 日付が古いだけで止まった出典は、人が同じ本文のハッシュで受け入れていれば、根拠に使える。本文が変わると、再び止まる
      if (
        status !== "active" &&
        fetched.ok &&
        sourceAccepted(decisions, url, fetched.hash) &&
        outcomes.every((o) => o.result === "pass" || (o.name === "freshness" && o.reason === "stale"))
      ) {
        status = "active";
      }
      if (fetched.ok) {
        cache.write(fetched.body);
        body = fetched.body;
      }
      const entry: SourceEntry = {
        url,
        kind: kindOf.get(url) ?? "official-doc",
        target,
        ...titleField(fetched.ok ? html : null, before?.title),
        fetchedAt: today,
        contentHash: fetched.ok ? fetched.hash : (before?.contentHash ?? null),
        updatedAt,
        status,
        checks: outcomes.map((o) => ({ name: o.name, result: o.result, ...(o.reason ? { reason: o.reason } : {}) })),
        claims: before?.claims ?? [],
      };
      // 変化の検知と再検証の印は、1 件ごとに台帳へ書く(再開しても、前回のハッシュとの比較を失わない)
      const observation: Observation = { url, hash: fetched.ok ? fetched.hash : null, fetchedAt: today, status };
      const change = detectChanges(before ? [before] : [], [observation]);
      changes.changed.push(...change.changed);
      changes.unconfirmed.push(...change.unconfirmed);
      ledger = { ...ledger, sources: [...ledger.sources.filter((s) => s.url !== url), entry] };
      if (change.changed.length > 0) {
        const found = traceAffected(ledger, [url], provenance, factSources);
        affected.facts.push(...found.facts);
        affected.questions.push(...found.questions);
        // 印は事実カードにだけ付ける(下書き・問題は、来歴の検査が判定する)
        ledger = markRecheck(ledger, { facts: found.facts, questions: [] });
      }
      writeLedger(paths.ledger, ledger);
      report(output, "取得", `${url} ${status}${fetched.ok ? "" : ` ${fetched.reason}`}`);
    }

    if (body !== null && depth < plan.scope.maxDepth) {
      for (const link of extractLinks(body.toString("utf8"), url)) {
        if (seen.has(link) || !inScope(plan, link)) continue;
        seen.add(link);
        if (kindOf.get(url) === "exam-guide" && !kindOf.has(link)) kindOf.set(link, "exam-guide");
        queue.push({ url: link, depth: depth + 1 });
      }
    }
  }

  for (const c of changes.changed)
    report(output, "出典の変化", `${c.url} ${c.previousFetchedAt ?? "-"} → ${c.fetchedAt} ${c.status}`);
  for (const c of changes.unconfirmed)
    report(output, "確認できない出典", `${c.url} ${c.previousFetchedAt ?? "-"} → ${c.fetchedAt} ${c.status}`);
  if (affected.facts.length + affected.questions.length > 0) {
    report(
      output,
      "再検証の印",
      `事実カード ${new Set(affected.facts).size} 件、根拠にした下書き・問題 ${new Set(affected.questions).size} 件`,
    );
  }
  // 対象がなくなった受け入れ(出典の本文が変わった、台帳から消えた)は、黙って捨てずに報告する
  for (const d of orphanDecisions(decisions, { sources: ledger.sources })) {
    if (d.target === "source") report(output, "判断の対象なし", `source ${d.url}`);
  }
  const blocked = ledger.sources.filter((s) => s.status !== "active");
  for (const s of blocked) {
    for (const c of s.checks)
      if (c.result !== "pass") report(output, "出典の検査", `${s.url} ${c.name} ${c.result} ${c.reason ?? ""}`.trim());
  }

  writeJson(paths.reportFile, {
    examCode,
    date: today,
    fetched: fetchedCount,
    resumed: resumedCount,
    limited,
    changed: changes.changed,
    unconfirmed: changes.unconfirmed,
    recheck: affected,
    sources: ledger.sources.map((s) => ({ url: s.url, status: s.status, checks: s.checks })),
  });

  writeGuideRequest(plan, ledger, cache, paths, rootDir, output, stamp);
  cache.sweep();

  report(output, "情報", `取得 ${fetchedCount} 件、再開で飛ばした ${resumedCount} 件、止めた出典 ${blocked.length} 件`);
  if (limited) {
    report(output, "件数の上限", `maxItemsPerRun(再実行で続きから進む)`);
    return EXIT.checkFailed;
  }
  // 止めた出典と、確認できない出典(取得に失敗した出典)は、失敗として数える
  return blocked.length > 0 || changes.unconfirmed.length > 0 ? EXIT.checkFailed : EXIT.ok;
}

/** 試験ガイドが使える状態なら、エージェントへの抽出の依頼を、作業用の置き場に書く */
function writeGuideRequest(
  plan: Plan,
  ledger: LedgerFile,
  cache: BodyCache,
  paths: Paths,
  rootDir: string,
  output: Output,
  stamp: AgentStamp,
): void {
  const ready = (url: string | undefined) => {
    const s = ledger.sources.find((e) => e.url === url);
    return s?.status === "active" && s.contentHash !== null && cache.has(s.contentHash)
      ? { url: s.url, contentHash: s.contentHash }
      : null;
  };
  const bodyPath = (hash: string) => relative(rootDir, join(paths.cacheDir, `${hash}.body`));
  const source = ready(plan.sources.find((s) => s.kind === "exam-guide")?.url);
  if (source === null) return;
  const pages = (plan.guidePages ?? []).map(ready);
  if (pages.some((p) => p === null)) {
    report(output, "試験ガイドの抽出の保留", "guide-page-not-ready");
    return;
  }
  const readyPages = pages.filter((p) => p !== null);
  const imported = ledger.guide;
  if (
    imported?.contentHash === source.contentHash &&
    sameDefinition(imported.agent, stamp) &&
    imported.pages.length === readyPages.length &&
    readyPages.every((p) => imported.pages.some((q) => q.url === p.url && q.contentHash === p.contentHash))
  ) {
    return;
  }
  const code = ledger.examCode.toLowerCase();
  const request: GuideRequest = {
    examCode: ledger.examCode,
    sourceUrl: source.url,
    contentHash: source.contentHash,
    bodyPath: bodyPath(source.contentHash),
    pages: readyPages.map((p) => ({ ...p, bodyPath: bodyPath(p.contentHash) })),
    outputPath: relative(rootDir, join(paths.guideDir, `${code}.extract.json`)),
    agent: stamp,
  };
  const requestPath = join(paths.guideDir, `${code}.request.json`);
  writeJson(requestPath, request);
  report(output, "試験ガイドの抽出の依頼", relative(rootDir, requestPath));
}

function importGuideStep(
  options: CollectOptions,
  paths: Paths,
  ledger: LedgerFile,
  masterDomains: { code: string; weight: number }[],
  masterExam: MasterExamValues,
): ExitCode {
  const { config, rootDir, examCode, output, deps, dryRun } = options;
  const stamp = readAgentStampOrReport(output, rootDir, "guide-extractor");
  if (stamp === null) return EXIT.checkFailed;
  const extractPath = join(paths.guideDir, `${examCode.toLowerCase()}.extract.json`);
  const requestPath = join(paths.guideDir, `${examCode.toLowerCase()}.request.json`);
  if (!existsSync(extractPath)) {
    report(output, "試験ガイドの取り込みの停止", "extract-not-found");
    return EXIT.checkFailed;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(extractPath, "utf8"));
  } catch {
    report(output, "試験ガイドの取り込みの停止", "extract-invalid");
    return EXIT.checkFailed;
  }
  // 依頼のあとに、エージェントの定義が変わった。取り込まず、依頼を作り直す
  const ctx: FlowContext = { output, stopLabel: "試験ガイドの取り込みの停止", dryRun };
  if (existsSync(requestPath)) {
    const request = readJsonFile(requestPath);
    if (request === null || typeof request !== "object") {
      reportStop(ctx, "guide", "request-invalid");
      return EXIT.checkFailed;
    }
    if (definitionChanged(request as { agent?: AgentStamp }, stamp)) {
      discardStale(ctx, "guide", requestPath, extractPath);
      return EXIT.checkFailed;
    }
  }
  const { plan, problems } = loadPlan(paths.plan, examCode);
  if (plan === null) {
    for (const p of problems) report(output, "計画の誤り", `${p.path} ${p.reason}`);
    return EXIT.checkFailed;
  }
  const cache = new BodyCache(paths.cacheDir, config.cache, deps.now);
  const readBody = (hash: string) => cache.read(hash)?.toString("utf8") ?? null;
  const result = importGuide(raw, ledger, plan.guidePages ?? [], readBody, deps.today(), stamp);
  if (!result.ok) {
    report(output, "試験ガイドの取り込みの停止", result.reason);
    return EXIT.checkFailed;
  }
  const diff = diffWithMaster(result.guide, masterDomains, masterExam);
  for (const code of diff.missingInMaster) report(output, "試験ガイドの差分", `マスタにない分野 ${code}`);
  for (const code of diff.extraInMaster) report(output, "試験ガイドの差分", `ガイドにない分野 ${code}`);
  for (const w of diff.weightMismatch) {
    report(output, "試験ガイドの差分", `配点のずれ ${w.code} ガイド ${w.guide} マスタ ${w.master}`);
  }
  // 本番の値(出題数・試験時間・合格点・満点): 食い違いは、項目の名前とガイド・マスタの値を報告する。報告だけで、0 で終わる
  for (const m of diff.examMismatch) {
    report(output, "試験ガイドの差分", `${m.item}のずれ ガイド ${m.guide} マスタ ${m.master}`);
  }
  for (const m of diff.examMissingInMaster) {
    report(output, "試験ガイドの差分", `マスタにない項目 ${m.item} ガイド ${m.guide}`);
  }
  if (result.guide.exam?.scoredQuestionCount !== undefined) {
    report(
      output,
      "情報",
      `ガイドが示す採点対象の問題数 ${result.guide.exam.scoredQuestionCount}(出題数とは突き合わせない)`,
    );
  }
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return EXIT.ok;
  }
  writeLedger(paths.ledger, { ...ledger, guide: result.guide });
  const total =
    diff.missingInMaster.length +
    diff.extraInMaster.length +
    diff.weightMismatch.length +
    diff.examMismatch.length +
    diff.examMissingInMaster.length;
  report(output, "情報", `試験ガイドを台帳に取り込んだ(マスタとの差分 ${total} 件。マスタは書き換えない)`);
  return EXIT.ok;
}
