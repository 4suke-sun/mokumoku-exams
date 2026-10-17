import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.ts";
import { ALLOWED_REFERENCE_HOSTS, EXAM_CODE, hostAllowedForVendor, sourceUrlReason } from "../contract.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { type Output, report } from "../log.ts";
import { type AgentStamp, readAgentStampOrReport } from "../shared/agents.ts";
import { prepareExam } from "../shared/exam.ts";
import { writeJson } from "../shared/fs.ts";
import {
  cleanupImported,
  definitionChanged,
  discardStale,
  type FlowContext,
  failOutput,
  listRequestFiles,
  readJsonFile,
  reportStop,
} from "../shared/request-flow.ts";
import { sha256 } from "./fetcher.ts";
import { LedgerError, type LedgerFile, ledgerPath, readLedger } from "./ledger.ts";
import { loadPlan, planPath } from "./plan.ts";

/**
 * 出典の候補の提案(ADR 0009)。出題範囲の項目ごとに、公式の文書を候補として挙げる。エージェント(source-scout)が挙げ、
 * CLI が URL の形・許可ドメイン・計画との重複を検査する。候補は提案にとどめ、計画には自動で入れない。
 * 人が候補を見て、計画の sources と scope.prefixes に足す。足したあとの collect が、既存の 5 つの検査を候補だった URL にも適用する。
 * 取得した本文は、依頼に載せない。
 */

/** 依頼の形が変わったら上げる。鍵に入るので、上げると依頼のキャッシュが切れる */
export const CANDIDATES_REQUEST_VERSION = 1;

const KEY = z.string().regex(/^[0-9a-f]{16}$/);
const DomainCode = z.string().regex(/^domain[1-9][0-9]?$/);

/** 依頼: 台帳の試験ガイドの出題範囲の項目(添字つき)、計画の今の出典、許可したホスト、項目ごとの候補の数の上限 */
export const CandidatesRequestSchema = z.strictObject({
  examCode: z.string().regex(EXAM_CODE),
  requestKey: KEY,
  vendor: z.string().min(1),
  /** 出題範囲の項目。item は、試験ガイドのその分野の scope の添字(0 から)。text は言い換え(本文ではない) */
  items: z.array(z.strictObject({ domain: DomainCode, item: z.number().int().min(0), text: z.string().min(1) })).min(1),
  /** 計画の今の sources の URL。ここにあるものは候補にしない */
  planSources: z.array(z.string()),
  /** このベンダーに許した出典のホスト(完全一致) */
  allowedHosts: z.array(z.string()).min(1),
  maxPerItem: z.number().int().min(1).max(20),
  outputPath: z.string().min(1),
  agent: z.strictObject({
    role: z.literal("source-scout"),
    model: z.string(),
    definitionHash: z.string(),
  }),
});

export type CandidatesRequest = z.infer<typeof CandidatesRequestSchema>;

/** エージェントが書く出力。項目ごとの候補の URL と、選んだ理由(短い言い換え) */
export const CandidatesOutputSchema = z.strictObject({
  examCode: z.string().min(1),
  requestKey: z.string().min(1),
  items: z.array(
    z.strictObject({
      domain: DomainCode,
      item: z.number().int().min(0),
      candidates: z
        .array(z.strictObject({ url: z.string().min(1).max(2000), reason: z.string().min(1).max(200) }))
        .max(20),
    }),
  ),
});

export type CandidatesOutput = z.infer<typeof CandidatesOutputSchema>;

/** 候補を落とす理由のコード(URL の形の理由は contract の sourceUrlReason と同じ) */
export type DropReason =
  | "host-not-allowed"
  | "already-in-plan"
  | "duplicate"
  | NonNullable<ReturnType<typeof sourceUrlReason>>;

export interface FilteredItem {
  domain: string;
  item: number;
  candidates: { url: string; reason: string }[];
  dropped: DropReason[];
}

/**
 * 1 項目の候補を検査する。https で形が正しく、このベンダーに許したホストで、計画の sources になく、項目の中で重複しないものだけを残す。
 * 落としたものは、理由コードだけを返す(URL は返さない)。
 */
export function filterCandidates(
  candidates: readonly { url: string; reason: string }[],
  context: { vendor: string; planSources: readonly string[] },
): { kept: { url: string; reason: string }[]; dropped: DropReason[] } {
  const kept: { url: string; reason: string }[] = [];
  const dropped: DropReason[] = [];
  const seen = new Set<string>();
  for (const c of candidates) {
    const problem = sourceUrlReason(c.url);
    if (problem !== null) {
      dropped.push(problem);
      continue;
    }
    if (!hostAllowedForVendor(new URL(c.url).hostname, context.vendor)) {
      dropped.push("host-not-allowed");
      continue;
    }
    if (context.planSources.includes(c.url)) {
      dropped.push("already-in-plan");
      continue;
    }
    if (seen.has(c.url)) {
      dropped.push("duplicate");
      continue;
    }
    seen.add(c.url);
    kept.push(c);
  }
  return { kept, dropped };
}

/** 依頼の鍵。依頼の内容(項目、計画の出典、許可ホスト、上限)とエージェントの定義のハッシュから決まる */
export function candidatesKey(
  input: Pick<CandidatesRequest, "examCode" | "items" | "planSources" | "allowedHosts" | "maxPerItem">,
  definitionHash: string,
): string {
  return sha256(Buffer.from(JSON.stringify([input, definitionHash, CANDIDATES_REQUEST_VERSION]))).slice(0, 16);
}

export type CandidatesMode = "request" | "import";

export interface CandidatesOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  mode: CandidatesMode;
  dryRun: boolean;
  output: Output;
}

interface Paths {
  ledger: string;
  plan: string;
  requestsDir: string;
  outDir: string;
  state: string;
  result: string;
}

function pathsFor(config: Config, rootDir: string, examCode: string): Paths {
  const work = resolve(rootDir, config.workDir, "candidates", examCode.toLowerCase());
  return {
    ledger: ledgerPath(resolve(rootDir, config.ledgerDir), examCode),
    plan: planPath(resolve(rootDir, config.plansDir), examCode),
    requestsDir: join(work, "requests"),
    outDir: join(work, "out"),
    state: join(work, "state.json"),
    result: join(work, "candidates.json"),
  };
}

function readAttempts(path: string): Record<string, number> {
  const raw = existsSync(path) ? readJsonFile(path) : undefined;
  if (raw === null || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number")) as Record<string, number>;
}

/** collect <資格コード> --candidates(依頼)と --import-candidates(取り込み) */
export function runCandidates(options: CandidatesOptions): ExitCode {
  const { config, rootDir, examCode, output } = options;
  const exam = prepareExam(options);
  if (!exam.ok) return exam.exit;
  const paths = pathsFor(config, rootDir, examCode);
  let ledger: LedgerFile;
  try {
    ledger = readLedger(paths.ledger, examCode);
  } catch (error) {
    if (!(error instanceof LedgerError)) throw error;
    for (const p of error.paths) report(output, "台帳の誤り", p);
    return EXIT.checkFailed;
  }
  if (ledger.guide === null) {
    report(output, "入力の誤り", "試験ガイドが台帳にない(collect --import-guide を先に実行する)");
    return EXIT.inputError;
  }
  const { plan, problems } = loadPlan(paths.plan, examCode);
  if (plan === null) {
    for (const p of problems) report(output, "計画の誤り", `${p.path} ${p.reason}`);
    return EXIT.checkFailed;
  }
  const stamp = readAgentStampOrReport(output, rootDir, "source-scout");
  if (stamp === null) return EXIT.checkFailed;

  const items = ledger.guide.domains.flatMap((d) => d.scope.map((text, item) => ({ domain: d.code, item, text })));
  if (items.length === 0) {
    report(output, "入力の誤り", "試験ガイドに出題範囲の項目がない");
    return EXIT.inputError;
  }
  const content = {
    examCode,
    items,
    planSources: plan.sources.map((s) => s.url).sort(),
    allowedHosts: ALLOWED_REFERENCE_HOSTS.filter((h) => hostAllowedForVendor(h, exam.master.exam.vendor)).sort(),
    maxPerItem: config.candidates.maxPerItem,
  };
  if (content.allowedHosts.length === 0) {
    report(output, "入力の誤り", "このベンダーに許した出典のホストがない");
    return EXIT.inputError;
  }
  const ctx = { options, paths, stamp, vendor: exam.master.exam.vendor, content };
  return options.mode === "request" ? requestStep(ctx) : importStep(ctx);
}

interface Context {
  options: CandidatesOptions;
  paths: Paths;
  stamp: AgentStamp;
  vendor: string;
  content: Pick<CandidatesRequest, "examCode" | "items" | "planSources" | "allowedHosts" | "maxPerItem">;
}

function requestStep(ctx: Context): ExitCode {
  const { options, paths, stamp, vendor, content } = ctx;
  const { config, rootDir, output, dryRun } = options;
  const key = candidatesKey(content, stamp.definitionHash);
  // 同じ入力の結果がすでにある
  const done = existsSync(paths.result)
    ? (readJsonFile(paths.result) as { requestKey?: string } | undefined)
    : undefined;
  if (done?.requestKey === key) {
    report(output, "情報", "候補は取り込み済み(同じ入力は依頼しない)");
    return EXIT.ok;
  }
  const requestPath = join(paths.requestsDir, `${key}.json`);
  if (existsSync(requestPath)) {
    report(output, "情報", "依頼 0 件、依頼済みで待っている 1 件");
    return EXIT.ok;
  }
  if ((readAttempts(paths.state)[key] ?? 0) >= config.candidates.maxAttempts) {
    report(output, "再試行の上限", "candidates max-attempts");
    return EXIT.checkFailed;
  }
  const request: CandidatesRequest = {
    ...content,
    requestKey: key,
    vendor,
    outputPath: relative(rootDir, join(paths.outDir, `${key}.json`)),
    agent: stamp as CandidatesRequest["agent"],
  };
  if (!dryRun) writeJson(requestPath, request);
  report(output, "候補の依頼", relative(rootDir, requestPath));
  report(output, "情報", `依頼 1 件(出題範囲の項目 ${content.items.length} 件)`);
  if (dryRun) report(output, "書き込みをしない(dry-run)");
  return EXIT.ok;
}

function importStep(ctx: Context): ExitCode {
  const { options, paths, stamp, vendor, content } = ctx;
  const { output, dryRun } = options;
  const flow: FlowContext = { output, stopLabel: "候補の取り込みの停止", dryRun };
  const attempts = readAttempts(paths.state);
  const currentKey = candidatesKey(content, stamp.definitionHash);
  let failures = 0;
  const doneFiles: string[] = [];

  for (const file of listRequestFiles(paths.requestsDir)) {
    const key = file.replace(/\.json$/, "");
    const outPath = join(paths.outDir, file);
    if (!existsSync(outPath)) {
      report(output, "候補の出力なし", key);
      continue;
    }
    const requestPath = join(paths.requestsDir, file);
    const parsedRequest = CandidatesRequestSchema.safeParse(readJsonFile(requestPath));
    if (!parsedRequest.success || parsedRequest.data.requestKey !== key) {
      reportStop(flow, key, "request-invalid");
      failures++;
      continue;
    }
    const request = parsedRequest.data;
    // 依頼のあとに、エージェントの定義・試験ガイド・計画が変わった。出力の形を見る前に、依頼を作り直す
    if (definitionChanged(request, stamp) || key !== currentKey) {
      discardStale(flow, key, requestPath, outPath);
      continue;
    }
    const fail = (reason: string) => {
      failOutput(flow, key, reason, outPath, attempts);
      failures++;
    };
    const parsed = CandidatesOutputSchema.safeParse(readJsonFile(outPath));
    if (!parsed.success) {
      fail("output-invalid");
      continue;
    }
    const out = parsed.data;
    if (out.examCode !== request.examCode || out.requestKey !== key) {
      fail("request-mismatch");
      continue;
    }
    // 依頼にない項目、同じ項目の重複、項目ごとの上限の超過は、出力の誤り
    const known = new Set(request.items.map((i) => `${i.domain}#${i.item}`));
    const seen = new Set<string>();
    const bad = out.items.some((i) => {
      const id = `${i.domain}#${i.item}`;
      const invalid = !known.has(id) || seen.has(id) || i.candidates.length > request.maxPerItem;
      seen.add(id);
      return invalid;
    });
    if (bad) {
      fail("output-invalid");
      continue;
    }

    const filtered: FilteredItem[] = request.items.map((i) => {
      const proposed = out.items.find((o) => o.domain === i.domain && o.item === i.item)?.candidates ?? [];
      const { kept, dropped } = filterCandidates(proposed, { vendor, planSources: request.planSources });
      return { domain: i.domain, item: i.item, candidates: kept, dropped };
    });
    const droppedCounts = new Map<string, number>();
    for (const f of filtered) for (const d of f.dropped) droppedCounts.set(d, (droppedCounts.get(d) ?? 0) + 1);
    for (const [reason, n] of [...droppedCounts].sort(([a], [b]) => (a < b ? -1 : 1))) {
      report(output, "候補の不採用", `${reason} ${n} 件`);
    }
    for (const f of filtered) {
      report(output, "候補", `${f.domain} 項目 ${f.item} 候補 ${f.candidates.length} 件`);
    }
    for (const f of filtered.filter((x) => x.candidates.length === 0)) {
      report(output, "候補のない項目", `${f.domain} 項目 ${f.item}`);
    }
    const total = filtered.reduce((n, f) => n + f.candidates.length, 0);
    report(
      output,
      "情報",
      `候補 ${total} 件(出題範囲の項目 ${filtered.length} 件、候補のない項目 ${filtered.filter((f) => f.candidates.length === 0).length} 件)`,
    );
    if (!dryRun) {
      writeJson(paths.result, {
        examCode: request.examCode,
        requestKey: key,
        items: filtered.map(({ domain, item, candidates }) => ({ domain, item, candidates })),
      });
    }
    doneFiles.push(file);
  }

  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return failures > 0 ? EXIT.checkFailed : EXIT.ok;
  }
  writeJson(paths.state, attempts);
  cleanupImported(doneFiles, paths.requestsDir, paths.outDir);
  return failures > 0 ? EXIT.checkFailed : EXIT.ok;
}
