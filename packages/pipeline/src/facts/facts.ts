import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { BodyCache } from "../collect/cache.ts";
import { clearRecheck } from "../collect/changes.ts";
import { loadExam } from "../collect/collect.ts";
import { LedgerError, type LedgerFile, ledgerPath, readLedger, writeLedger } from "../collect/ledger.ts";
import type { Config } from "../config.ts";
import { EXAM_CODE } from "../contract.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { type Output, report } from "../log.ts";
import { computeCoverage } from "./coverage.ts";
import { detectConflicts, mergeDuplicates } from "./dedupe.ts";
import { buildCards, FactsOutputSchema, type FactsRequest, requestKey } from "./extract.ts";
import { checkGrounding } from "./grounding.ts";
import { COPY_PLACEHOLDER, hasLongCopy } from "./overlap.ts";
import { buildReview, renderReview } from "./review.ts";
import {
  checkFactsContext,
  type FactCard,
  FactsError,
  type FactsFile,
  factsPath,
  readFacts,
  writeFacts,
} from "./schema.ts";

/**
 * facts コマンド: 出典から事実カードを作る。
 * - facts <資格コード>              抽出の依頼を作業用の置き場に書く(同じ入力は依頼しない)
 * - facts <資格コード> --import     エージェントの出力を検査して取り込む(照合・写し・重複・矛盾)
 * - facts <資格コード> --coverage   分野ごとの件数と、試験ガイドの範囲に対する抜けを報告する
 * - facts <資格コード> --report     本文を含まないレビューレポートを作業用の置き場に書く
 */

export type FactsMode = "request" | "import" | "coverage" | "report";

export interface FactsDeps {
  today(): string;
  now(): number;
}

export interface FactsOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  mode: FactsMode;
  dryRun: boolean;
  output: Output;
  deps: FactsDeps;
}

interface Paths {
  ledger: string;
  facts: string;
  cacheDir: string;
  requestsDir: string;
  outDir: string;
  stateFile: string;
  reviewJson: string;
  reviewMd: string;
}

function pathsFor(config: Config, rootDir: string, examCode: string): Paths {
  const work = resolve(rootDir, config.workDir, "facts", examCode.toLowerCase());
  return {
    ledger: ledgerPath(resolve(rootDir, config.ledgerDir), examCode),
    facts: factsPath(resolve(rootDir, config.factsDir), examCode),
    cacheDir: join(resolve(rootDir, config.workDir), "cache"),
    requestsDir: join(work, "requests"),
    outDir: join(work, "out"),
    stateFile: join(work, "state.json"),
    reviewJson: join(work, "review.json"),
    reviewMd: join(work, "review.md"),
  };
}

type State = Record<string, number>;

function readState(path: string): State {
  if (!existsSync(path)) return {};
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (raw === null || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number")) as State;
  } catch {
    return {};
  }
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export async function runFacts(options: FactsOptions): Promise<ExitCode> {
  const { config, rootDir, examCode, output } = options;
  if (!EXAM_CODE.test(examCode)) {
    report(output, "入力の誤り", "資格コードの形");
    return EXIT.inputError;
  }
  let master: ReturnType<typeof loadExam>;
  try {
    master = loadExam(config, rootDir, examCode);
  } catch {
    report(output, "資格マスタの誤り", config.examsFile);
    return EXIT.inputError;
  }
  if (master === null) {
    report(output, "入力の誤り", "資格マスタにない資格コード");
    return EXIT.inputError;
  }
  const paths = pathsFor(config, rootDir, examCode);
  let ledger: LedgerFile;
  let facts: FactsFile;
  try {
    ledger = readLedger(paths.ledger, examCode);
    facts = readFacts(paths.facts, examCode);
  } catch (error) {
    if (error instanceof LedgerError) for (const p of error.paths) report(output, "台帳の誤り", p);
    else if (error instanceof FactsError) for (const p of error.paths) report(output, "事実カードの誤り", p);
    else throw error;
    return EXIT.checkFailed;
  }
  const domains = master.domains.map((d) => d.code);
  switch (options.mode) {
    case "request":
      return requestStep(options, paths, ledger, facts, master.domains);
    case "import":
      return importStep(options, paths, ledger, facts, domains);
    case "coverage":
      return coverageStep(options, ledger, facts, domains);
    case "report":
      return reportStep(options, paths, facts, domains);
  }
}

function requestStep(
  options: FactsOptions,
  paths: Paths,
  ledger: LedgerFile,
  facts: FactsFile,
  masterDomains: { code: string; name: string }[],
): ExitCode {
  const { config, rootDir, examCode, output, deps, dryRun } = options;
  const cache = new BodyCache(paths.cacheDir, config.cache, deps.now);
  const state = readState(paths.stateFile);
  const domains = masterDomains.map((d) => ({
    code: d.code,
    name: d.name,
    scope: ledger.guide?.domains.find((g) => g.code === d.code)?.scope ?? [],
  }));
  let requested = 0;
  let skipped = 0;
  let exhausted = 0;
  let missingBody = 0;
  let limited = false;
  for (const source of [...ledger.sources].sort((a, b) => (a.url < b.url ? -1 : 1))) {
    if (source.status !== "active" || source.contentHash === null) continue;
    // 試験ガイドのページは、分野・出題範囲の材料(台帳の guide)で、事実カードの根拠にしない
    if (source.kind === "exam-guide") continue;
    const hash = source.contentHash;
    if (facts.extracted.some((e) => e.url === source.url && e.contentHash === hash)) {
      skipped++;
      continue;
    }
    if (!cache.has(hash)) {
      report(output, "事実カードの本文なし", source.url);
      missingBody++;
      continue;
    }
    const key = requestKey(source.url, hash);
    if ((state[key] ?? 0) >= config.facts.maxAttempts) {
      report(output, "再試行の上限", source.url);
      exhausted++;
      continue;
    }
    if (requested >= config.maxItemsPerRun) {
      limited = true;
      break;
    }
    const request: FactsRequest = {
      examCode,
      sourceUrl: source.url,
      contentHash: hash,
      bodyPath: relative(rootDir, join(paths.cacheDir, `${hash}.body`)),
      outputPath: relative(rootDir, join(paths.outDir, `${key}.json`)),
      target: {
        ...(source.target.edition !== undefined ? { edition: source.target.edition } : {}),
        ...(source.target.region !== undefined ? { region: source.target.region } : {}),
      },
      domains,
    };
    const requestPath = join(paths.requestsDir, `${key}.json`);
    if (!dryRun) writeJson(requestPath, request);
    report(output, "事実カードの依頼", relative(rootDir, requestPath));
    requested++;
  }
  report(output, "情報", `依頼 ${requested} 件、抽出済みで飛ばした ${skipped} 件`);
  if (dryRun) report(output, "書き込みをしない(dry-run)");
  if (limited) report(output, "件数の上限", "maxItemsPerRun(再実行で続きから進む)");
  // 本文がない出典は、依頼を書けなかった失敗として数える(ほかの出典の依頼は書く)
  return limited || exhausted > 0 || missingBody > 0 ? EXIT.checkFailed : EXIT.ok;
}

function importStep(
  options: FactsOptions,
  paths: Paths,
  initialLedger: LedgerFile,
  facts: FactsFile,
  domains: string[],
): ExitCode {
  const { config, examCode, output, deps, dryRun } = options;
  const cache = new BodyCache(paths.cacheDir, config.cache, deps.now);
  const state = readState(paths.stateFile);
  const requestFiles = existsSync(paths.requestsDir)
    ? readdirSync(paths.requestsDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];

  const incoming: FactCard[] = [];
  const extracted: { url: string; contentHash: string }[] = [];
  const doneFiles: string[] = [];
  let failures = 0;

  for (const file of requestFiles) {
    const key = file.replace(/\.json$/, "");
    const outPath = join(paths.outDir, file);
    if (!existsSync(outPath)) {
      report(output, "事実カードの出力なし", key);
      continue;
    }
    let request: FactsRequest;
    try {
      request = JSON.parse(readFileSync(join(paths.requestsDir, file), "utf8")) as FactsRequest;
    } catch {
      report(output, "事実カードの取り込みの停止", `${key} request-invalid`);
      failures++;
      continue;
    }
    const fail = (reason: string) => {
      report(output, "事実カードの取り込みの停止", `${key} ${reason}`);
      failures++;
      if (!dryRun) {
        state[key] = (state[key] ?? 0) + 1;
        rmSync(outPath, { force: true });
      }
    };
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(outPath, "utf8"));
    } catch {
      fail("extract-invalid");
      continue;
    }
    const parsed = FactsOutputSchema.safeParse(raw);
    if (!parsed.success) {
      fail("extract-invalid");
      continue;
    }
    const out = parsed.data;
    if (out.examCode !== examCode || out.sourceUrl !== request.sourceUrl || out.contentHash !== request.contentHash) {
      fail("request-mismatch");
      continue;
    }
    const source = initialLedger.sources.find((s) => s.url === request.sourceUrl);
    if (source?.status !== "active" || source.contentHash !== request.contentHash) {
      // 収集が進んで、依頼のもとにした本文が古くなった。依頼を作り直す
      report(output, "事実カードの取り込みの停止", `${key} request-stale`);
      if (!dryRun) {
        rmSync(join(paths.requestsDir, file), { force: true });
        rmSync(outPath, { force: true });
      }
      continue;
    }
    const body = cache.has(request.contentHash) ? (cache.read(request.contentHash)?.toString("utf8") ?? null) : null;
    const cards = buildCards(out, { url: source.url, contentHash: request.contentHash, target: source.target });
    const guide = initialLedger.guide?.domains;
    for (const card of cards) {
      const reasons = new Set<string>();
      if (!domains.includes(card.domain)) reasons.add("unknown-domain");
      const size = guide?.find((g) => g.code === card.domain)?.scope.length;
      if (size !== undefined && card.scopeItems.some((n) => n >= size)) reasons.add("scope-item-out-of-range");
      if (body !== null && hasLongCopy(card.claim, body)) reasons.add("long-copy");
      const evidence = card.sources[0] as FactCard["sources"][number];
      for (const r of checkGrounding(card.claim, evidence, source, body)) reasons.add(r);
      incoming.push({
        ...card,
        // 本文の写しは、不採用でも台帳に残さない
        claim: reasons.has("long-copy") ? COPY_PLACEHOLDER : card.claim,
        status: reasons.size > 0 ? "rejected" : "passed",
        reasons: [...reasons],
      });
    }
    extracted.push({ url: source.url, contentHash: request.contentHash });
    doneFiles.push(file);
  }

  // 再抽出した出典の古いカードは、新しい抽出で置き換える(複数の出典を持つカードは、その出典の根拠だけを外す)
  const replacedUrls = new Set(extracted.map((e) => e.url));
  const removedIds: string[] = [];
  const retained: FactCard[] = [];
  for (const card of facts.cards) {
    if (!card.sources.some((s) => replacedUrls.has(s.url))) {
      retained.push(card);
      continue;
    }
    removedIds.push(card.id);
    const rest = card.sources.filter((s) => !replacedUrls.has(s.url));
    if (rest.length > 0) retained.push({ ...card, sources: rest });
  }

  // 保留の判定は毎回やり直す(不採用は変えない)
  const pool = [...retained, ...incoming].map((c) =>
    c.status === "rejected" ? c : { ...c, status: "passed" as const, reasons: [] },
  );
  const merged = mergeDuplicates(pool);
  const pairs = detectConflicts(merged.cards);
  const held = new Set(pairs.flatMap((p) => [p.a, p.b]));
  const cards = merged.cards.map((c) =>
    held.has(c.id) ? { ...c, status: "held" as const, reasons: ["conflict"] } : c,
  );

  const rejectedNow = incoming.filter((c) => c.status === "rejected");
  const reasonCounts = new Map<string, number>();
  for (const c of rejectedNow) for (const r of c.reasons) reasonCounts.set(r, (reasonCounts.get(r) ?? 0) + 1);
  for (const [reason, n] of [...reasonCounts].sort(([a], [b]) => (a < b ? -1 : 1))) {
    report(output, "事実カードの不採用", `${reason} ${n} 件`);
  }
  for (const p of pairs) report(output, "事実カードの保留", `conflict ${p.a} ${p.b}`);
  report(
    output,
    "情報",
    `取り込み: 抽出 ${incoming.length} 件、通過 ${incoming.length - rejectedNow.length} 件、不採用 ${rejectedNow.length} 件、重複をまとめた ${merged.merged} 件、保留 ${held.size} 件`,
  );

  const next: FactsFile = {
    examCode,
    extracted: [...facts.extracted.filter((e) => !replacedUrls.has(e.url)), ...extracted],
    cards,
  };
  const problems = checkFactsContext(next, {
    domains,
    scopeSizes: initialLedger.guide
      ? Object.fromEntries(initialLedger.guide.domains.map((g) => [g.code, g.scope.length]))
      : null,
  });
  // マスタにない分野などは、取り込みの前に不採用にしてあるので、ここに残るのは想定外の誤り
  const unexpected = problems.filter((p) => !rejectedIndexes(next, p));

  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return failures > 0 || unexpected.length > 0 ? EXIT.checkFailed : EXIT.ok;
  }
  if (unexpected.length > 0) {
    for (const p of unexpected) report(output, "事実カードの誤り", p);
    return EXIT.checkFailed;
  }
  // 取り込めたものがなければ、事実カードの台帳は変えない(失敗の回数だけ記録する)
  if (extracted.length > 0) writeFacts(paths.facts, next);
  writeJson(paths.stateFile, state);
  if (removedIds.length > 0) {
    writeLedger(paths.ledger, clearRecheck(initialLedger, { facts: removedIds }));
  }
  for (const file of doneFiles) {
    rmSync(join(paths.requestsDir, file), { force: true });
    rmSync(join(paths.outDir, file), { force: true });
  }
  return failures > 0 ? EXIT.checkFailed : EXIT.ok;
}

/** 検査の場所(cards.N.…)のカードが、不採用になっているか。不採用のカードの誤りは、理由コードで記録済み */
function rejectedIndexes(file: FactsFile, path: string): boolean {
  const n = Number(/^cards\.(\d+)\./.exec(path)?.[1]);
  return Number.isInteger(n) && file.cards[n]?.status === "rejected";
}

function coverageStep(options: FactsOptions, ledger: LedgerFile, facts: FactsFile, domains: string[]): ExitCode {
  const { output } = options;
  const problems = checkFactsContext(facts, {
    domains,
    scopeSizes: ledger.guide ? Object.fromEntries(ledger.guide.domains.map((g) => [g.code, g.scope.length])) : null,
  });
  // 不採用のカードの誤りは、不採用の理由として残してある。通過・保留のカードの誤りだけを失敗にする
  const failing = problems.filter((p) => !rejectedIndexes(facts, p));
  if (failing.length > 0) {
    for (const p of failing) report(output, "事実カードの誤り", p);
    return EXIT.checkFailed;
  }
  const coverage = computeCoverage(facts.cards, domains, ledger.guide);
  for (const d of coverage.byDomain) {
    report(output, "カバレッジ", `${d.domain} 通過 ${d.passed} 件、保留 ${d.held} 件、不採用 ${d.rejected} 件`);
  }
  for (const g of coverage.gaps) report(output, "カバレッジの抜け", `${g.domain} 項目 ${g.item}`);
  if (ledger.guide === null) report(output, "情報", "試験ガイドが台帳にないので、範囲に対する抜けは調べていない");
  return EXIT.ok;
}

function reportStep(options: FactsOptions, paths: Paths, facts: FactsFile, domains: string[]): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
  const review = buildReview(examCode, facts.cards, domains, config.facts.sampleSeed, config.facts.samplePerDomain);
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return EXIT.ok;
  }
  writeJson(paths.reviewJson, review);
  mkdirSync(dirname(paths.reviewMd), { recursive: true });
  writeFileSync(paths.reviewMd, renderReview(review));
  report(output, "レビューレポート", relative(rootDir, paths.reviewMd));
  return EXIT.ok;
}
