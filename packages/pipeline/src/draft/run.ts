import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { loadExam } from "../collect/collect.ts";
import type { Config } from "../config.ts";
import { EXAM_CODE } from "../contract.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { FactsError, type FactsFile, factsPath, readFacts } from "../facts/schema.ts";
import { type Output, report } from "../log.ts";
import { PlanError, type PlanFile, planPath, readPlan } from "../plan/schema.ts";
import {
  type DraftRequest,
  DraftRequestSchema,
  DraftsOutputSchema,
  requestKey,
  selectFacts,
  styleRuleSummaries,
} from "./request.ts";
import { assembleQuestion, draftId, schemaProblems } from "./schema.ts";
import {
  type DraftRecord,
  DraftsError,
  type DraftsFile,
  draftWorkDir,
  readDrafts,
  readState,
  writeDrafts,
  writeState,
} from "./store.ts";
import { evaluateStyle, STYLE_VERSION } from "./style.ts";

/**
 * draft コマンド: 出題計画と事実カードから、選択式の問題の下書きを作る。
 * - draft <資格コード>            計画の項目ごとに、下書きの依頼を作業用の置き場に書く(同じ入力は依頼しない)
 * - draft <資格コード> --import   エージェントの出力を検査して取り込む(形、スタイル規則、根拠の事実カード)
 * モデルは呼ばない。下書きはエージェント(question-drafter)が書く(ADR 0009)。data/ は変えない。
 */

export type DraftMode = "request" | "import";

export interface DraftOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  mode: DraftMode;
  dryRun: boolean;
  output: Output;
}

interface Paths {
  plan: string;
  facts: string;
  requestsDir: string;
  outDir: string;
  drafts: string;
  state: string;
}

function pathsFor(config: Config, rootDir: string, examCode: string): Paths {
  const work = resolve(rootDir, config.workDir);
  const dir = draftWorkDir(work, examCode);
  return {
    plan: planPath(work, examCode),
    facts: factsPath(resolve(rootDir, config.factsDir), examCode),
    requestsDir: join(dir, "requests"),
    outDir: join(dir, "out"),
    drafts: join(dir, "drafts.json"),
    state: join(dir, "state.json"),
  };
}

function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}

export function runDraft(options: DraftOptions): ExitCode {
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
  if (master === null || master.officialQuestionCount === null) {
    report(output, "入力の誤り", "公開中の資格ではない");
    return EXIT.inputError;
  }
  const paths = pathsFor(config, rootDir, examCode);
  let facts: FactsFile;
  let drafts: DraftsFile;
  try {
    facts = readFacts(paths.facts, examCode);
    drafts = readDrafts(paths.drafts, examCode);
  } catch (error) {
    if (error instanceof FactsError) for (const p of error.paths) report(output, "事実カードの誤り", p);
    else if (error instanceof DraftsError) for (const p of error.paths) report(output, "下書きの誤り", p);
    else throw error;
    return EXIT.checkFailed;
  }
  return options.mode === "request"
    ? requestStep(options, paths, master.domains, facts, drafts)
    : importStep(options, paths, facts, drafts);
}

function requestStep(
  options: DraftOptions,
  paths: Paths,
  masterDomains: { code: string; name: string }[],
  facts: FactsFile,
  drafts: DraftsFile,
): ExitCode {
  const { config, rootDir, examCode, output, dryRun } = options;
  let plan: PlanFile | null;
  try {
    plan = readPlan(paths.plan);
  } catch (error) {
    if (error instanceof PlanError) {
      for (const p of error.paths) report(output, "出題計画の誤り", p);
      return EXIT.checkFailed;
    }
    throw error;
  }
  if (plan === null) {
    report(output, "入力の誤り", "出題計画がない(plan を先に実行する)");
    return EXIT.inputError;
  }
  const state = readState(paths.state);
  const usage = new Map<string, number>();
  for (const d of drafts.drafts) {
    if (d.draft === null) continue;
    for (const id of d.draft.factIds) usage.set(id, (usage.get(id) ?? 0) + 1);
  }
  const settings = config.draft;
  let requested = 0;
  let satisfied = 0;
  let cached = 0;
  let pending = 0;
  let unsupported = 0;
  let exhausted = 0;
  let limited = false;
  const noFacts = new Set<string>();
  for (const item of plan.items) {
    if (item.kind === "free-text") {
      unsupported++;
      continue;
    }
    const have = drafts.drafts.filter((d) => d.planItemId === item.id && d.status !== "rejected").length;
    const remaining = item.count - have;
    if (remaining <= 0) {
      satisfied++;
      continue;
    }
    const cards = facts.cards.filter((c) => c.status === "passed" && c.domain === item.domain);
    if (cards.length === 0) {
      if (!noFacts.has(item.domain)) report(output, "下書きの誤り", `no-facts ${item.domain}`);
      noFacts.add(item.domain);
      continue;
    }
    const round = state.rounds[item.id] ?? 0;
    if (round >= settings.maxRounds) {
      report(output, "再試行の上限", item.id);
      exhausted++;
      continue;
    }
    const selected = selectFacts(cards, usage, settings.maxFactsPerRequest);
    const count = Math.min(remaining, settings.maxPerRequest);
    const key = requestKey({ examCode, planItemId: item.id, count, round, facts: selected });
    if (state.done.includes(key)) {
      cached++;
      continue;
    }
    if ((state.attempts[key] ?? 0) >= settings.maxAttempts) {
      report(output, "再試行の上限", item.id);
      exhausted++;
      continue;
    }
    const requestPath = join(paths.requestsDir, `${key}.json`);
    if (existsSync(requestPath)) {
      pending++;
      continue;
    }
    if (requested >= config.maxItemsPerRun) {
      limited = true;
      break;
    }
    const request: DraftRequest = {
      examCode,
      requestKey: key,
      planItemId: item.id,
      domain: {
        code: item.domain,
        name: masterDomains.find((d) => d.code === item.domain)?.name ?? item.domain,
      },
      difficulty: item.difficulty,
      kind: item.kind,
      count,
      facts: selected.map((c) => ({ id: c.id, claim: c.claim, confidence: c.confidence, scope: c.scope })),
      styleVersion: STYLE_VERSION,
      styleRules: styleRuleSummaries(),
      outputPath: relative(rootDir, join(paths.outDir, `${key}.json`)),
    };
    if (!dryRun) writeJson(requestPath, request);
    report(output, "下書きの依頼", relative(rootDir, requestPath));
    requested++;
  }
  report(
    output,
    "情報",
    `依頼 ${requested} 件、依頼済みで待っている ${pending} 件、計画を満たして飛ばした ${satisfied} 件、取り込み済みの入力で飛ばした ${cached} 件、自由記述で飛ばした ${unsupported} 件`,
  );
  if (dryRun) report(output, "書き込みをしない(dry-run)");
  if (limited) report(output, "件数の上限", "maxItemsPerRun(再実行で続きから進む)");
  return limited || exhausted > 0 || noFacts.size > 0 ? EXIT.checkFailed : EXIT.ok;
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort();
}

function importStep(options: DraftOptions, paths: Paths, facts: FactsFile, current: DraftsFile): ExitCode {
  const { examCode, output, dryRun } = options;
  const state = readState(paths.state);
  const requestFiles = existsSync(paths.requestsDir)
    ? readdirSync(paths.requestsDir)
        .filter((f) => f.endsWith(".json"))
        .sort()
    : [];
  const incoming: DraftRecord[] = [];
  const doneFiles: string[] = [];
  let failures = 0;
  let accepted = 0;
  let rejected = 0;

  for (const file of requestFiles) {
    const key = file.replace(/\.json$/, "");
    const outPath = join(paths.outDir, file);
    if (!existsSync(outPath)) {
      report(output, "下書きの出力なし", key);
      continue;
    }
    let request: DraftRequest;
    try {
      const parsed = DraftRequestSchema.safeParse(JSON.parse(readFileSync(join(paths.requestsDir, file), "utf8")));
      if (!parsed.success || parsed.data.requestKey !== key) throw new Error("request-invalid");
      request = parsed.data;
    } catch {
      report(output, "下書きの取り込みの停止", `${key} request-invalid`);
      failures++;
      continue;
    }
    const fail = (reason: string) => {
      report(output, "下書きの取り込みの停止", `${key} ${reason}`);
      failures++;
      if (!dryRun) {
        state.attempts[key] = (state.attempts[key] ?? 0) + 1;
        rmSync(outPath, { force: true });
      }
    };
    let out: ReturnType<typeof DraftsOutputSchema.parse>;
    try {
      const parsed = DraftsOutputSchema.safeParse(JSON.parse(readFileSync(outPath, "utf8")));
      if (!parsed.success) throw new Error("output-invalid");
      out = parsed.data;
    } catch {
      fail("output-invalid");
      continue;
    }
    if (out.examCode !== examCode || out.requestKey !== request.requestKey || out.planItemId !== request.planItemId) {
      fail("request-mismatch");
      continue;
    }
    if (out.drafts.length > request.count) {
      fail("output-invalid");
      continue;
    }
    // 依頼のあとに、事実カードが変わった(消えた、通過でなくなった、主張が変わった)。依頼を作り直す
    const stale = request.facts.some((f) => {
      const card = facts.cards.find((c) => c.id === f.id);
      return card === undefined || card.status !== "passed" || card.claim !== f.claim;
    });
    if (stale) {
      report(output, "下書きの取り込みの停止", `${key} request-stale`);
      if (!dryRun) {
        rmSync(join(paths.requestsDir, file), { force: true });
        rmSync(outPath, { force: true });
      }
      continue;
    }
    const factIds = new Set(request.facts.map((f) => f.id));
    const batch: DraftRecord[] = [];
    let invalid = false;
    for (const draft of out.drafts) {
      const id = draftId(examCode, request.planItemId, draft.factIds, draft.questionText);
      const reasons: string[] = [];
      if (draft.questionType !== request.kind) reasons.push("kind-mismatch");
      if (!draft.factIds.every((f) => factIds.has(f))) reasons.push("fact-not-in-request");
      const verdict = evaluateStyle(draft);
      for (const f of verdict.blockers) reasons.push(`style:${f.rule}`);
      if (reasons.length === 0) {
        const urls = uniqueSorted(
          draft.factIds.flatMap((fid) => facts.cards.find((c) => c.id === fid)?.sources.map((s) => s.url) ?? []),
        ).slice(0, 10);
        const problems = schemaProblems(
          assembleQuestion(draft, {
            examCode,
            domain: request.domain.code,
            difficulty: request.difficulty,
            referenceUrls: urls,
          }),
        );
        if (problems.length > 0) {
          invalid = true;
          break;
        }
      }
      for (const f of verdict.blockers) report(output, "下書きの不採用", `${id} ${f.rule} ${f.path}`);
      for (const r of reasons.filter((r) => !r.startsWith("style:"))) report(output, "下書きの不採用", `${id} ${r}`);
      for (const f of verdict.warnings) report(output, "下書きの警告", `${id} ${f.rule} ${f.path}`);
      batch.push({
        id,
        planItemId: request.planItemId,
        domain: request.domain.code,
        difficulty: request.difficulty,
        status: reasons.length > 0 ? "rejected" : "passed",
        reasons: uniqueSorted(reasons),
        warnings: verdict.warnings.map((f) => ({ rule: f.rule, path: f.path })),
        draft: reasons.length > 0 ? null : draft,
      });
    }
    if (invalid) {
      fail("schema-invalid");
      continue;
    }
    const known = new Set([...current.drafts, ...incoming].map((d) => d.id));
    for (const record of batch) {
      if (known.has(record.id)) continue;
      known.add(record.id);
      incoming.push(record);
      if (record.status === "passed") accepted++;
      else rejected++;
    }
    const takenHere = batch.filter((r) => r.status === "passed").length;
    state.done.push(key);
    // 全件が不採用だったときだけ、計画の項目の依頼を出し直す(回数に上限がある)
    if (takenHere === 0) state.rounds[request.planItemId] = (state.rounds[request.planItemId] ?? 0) + 1;
    doneFiles.push(file);
  }

  report(output, "情報", `取り込み: 通過 ${accepted} 件、不採用 ${rejected} 件、停止 ${failures} 件`);
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return failures > 0 ? EXIT.checkFailed : EXIT.ok;
  }
  const next: DraftsFile = { examCode, drafts: [...current.drafts, ...incoming] };
  if (incoming.length > 0) writeDrafts(paths.drafts, next);
  writeState(paths.state, state);
  for (const file of doneFiles) {
    rmSync(join(paths.requestsDir, file), { force: true });
    rmSync(join(paths.outDir, file), { force: true });
  }
  return failures > 0 ? EXIT.checkFailed : EXIT.ok;
}
