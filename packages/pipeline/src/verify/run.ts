import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { BodyCache } from "../collect/cache.ts";
import type { Config } from "../config.ts";
import { DecisionsError, decisionsPath, draftDecision, readDecisions } from "../decisions/decisions.ts";
import { ProvenanceError, type ProvenanceFile, provenancePath, readProvenance } from "../draft/provenance.ts";
import { isChoiceDraft } from "../draft/schema.ts";
import {
  applyDraftDecisions,
  type DraftRecord,
  DraftsError,
  type DraftsFile,
  draftWorkDir,
  readDrafts,
  writeDrafts,
} from "../draft/store.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { FactsError, type FactsFile, factsPath, readFacts } from "../facts/schema.ts";
import { type Output, report } from "../log.ts";
import { type AgentStamp, readAgentStampOrReport } from "../shared/agents.ts";
import { detectCopy } from "../shared/copy.ts";
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
import { buildVerifyRequest, checkExplanationOutput, checkRederiveOutput } from "./check.ts";
import {
  collectSections,
  draftTexts,
  ExplanationOutputSchema,
  evidenceHash,
  RederiveOutputSchema,
  type VerifyRequest,
  VerifyRequestSchema,
  verifyKey,
} from "./request.ts";
import { type Verdict, type Verification, type VerifyCode, verifyReason } from "./schema.ts";

/**
 * verify コマンド: 下書きを、根拠にした出典の節だけを根拠に、検証役が確かめる(ADR 0007・0009)。
 * - verify <資格コード>            検証の依頼を作業用の置き場に書く(同じ入力は依頼しない)
 * - verify <資格コード> --import   検証役の出力を、下書きの宣言と照合して取り込む
 * モデルは呼ばない。検証はエージェント(question-verifier)が行う。data/ は変えない。
 * 再導出(選択肢ごとの正誤)が合格した下書きだけが、解説の確認の依頼に進む。
 */

export type VerifyMode = "request" | "import";

export interface VerifyOptions {
  config: Config;
  rootDir: string;
  examCode: string;
  mode: VerifyMode;
  dryRun: boolean;
  output: Output;
}

interface Paths {
  facts: string;
  provenance: string;
  decisions: string;
  drafts: string;
  cacheDir: string;
  requestsDir: string;
  outDir: string;
  state: string;
}

function pathsFor(config: Config, rootDir: string, examCode: string): Paths {
  const work = resolve(rootDir, config.workDir);
  const verifyDir = join(work, "verify", examCode.toLowerCase());
  return {
    facts: factsPath(resolve(rootDir, config.factsDir), examCode),
    provenance: provenancePath(resolve(rootDir, config.provenanceDir), examCode),
    decisions: decisionsPath(resolve(rootDir, config.decisionsDir), examCode),
    drafts: join(draftWorkDir(work, examCode), "drafts.json"),
    cacheDir: join(work, "cache"),
    requestsDir: join(verifyDir, "requests"),
    outDir: join(verifyDir, "out"),
    state: join(verifyDir, "state.json"),
  };
}

/** 依頼の鍵ごとの、形の検査に通らなかった回数 */
function readAttempts(path: string): Record<string, number> {
  const raw = existsSync(path) ? readJsonFile(path) : undefined;
  if (raw === null || typeof raw !== "object") return {};
  return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "number")) as Record<string, number>;
}

export function runVerify(options: VerifyOptions): ExitCode {
  const { config, rootDir, examCode, output } = options;
  const exam = prepareExam(options, { production: true });
  if (!exam.ok) return exam.exit;
  const paths = pathsFor(config, rootDir, examCode);
  let facts: FactsFile;
  let drafts: DraftsFile;
  let provenance: ProvenanceFile;
  let decisions: ReturnType<typeof readDecisions>;
  try {
    facts = readFacts(paths.facts, examCode);
    drafts = readDrafts(paths.drafts, examCode);
    provenance = readProvenance(paths.provenance, examCode);
    decisions = readDecisions(paths.decisions, examCode);
  } catch (error) {
    if (error instanceof FactsError) for (const p of error.paths) report(output, "事実カードの誤り", p);
    else if (error instanceof DraftsError) for (const p of error.paths) report(output, "下書きの誤り", p);
    else if (error instanceof ProvenanceError) for (const p of error.paths) report(output, "来歴の誤り", p);
    else if (error instanceof DecisionsError) for (const p of error.paths) report(output, "判断の記録の誤り", p);
    else throw error;
    return EXIT.checkFailed;
  }
  const stamp = readAgentStampOrReport(output, rootDir, "question-verifier");
  if (stamp === null) return EXIT.checkFailed;
  // 人の判断(保留の解除・承認・却下)を、下書きの状態に反映して扱う
  drafts = applyDraftDecisions(drafts, (id) => draftDecision(decisions, id)).file;
  const ctx: Context = { options, paths, facts, drafts, provenance, decisions, stamp };
  return options.mode === "request" ? requestStep(ctx) : importStep(ctx);
}

interface Context {
  options: VerifyOptions;
  paths: Paths;
  facts: FactsFile;
  drafts: DraftsFile;
  provenance: ProvenanceFile;
  decisions: ReturnType<typeof readDecisions>;
  stamp: AgentStamp;
}

/**
 * 検証の対象: 不採用でなく、来歴がある下書き(通過・保留)。保留の理由は問わない。
 * 検証で解けるのは ambiguous の保留だけで、review などの保留は、検証が合格でも保留のまま残る(人が解く)。
 * 人の承認がある下書きも検証する(承認しても、検証を通っていない下書きは書き出せないため)。
 */
function eligible(record: DraftRecord, ctx: Context): boolean {
  if (record.draft === null || record.status === "rejected") return false;
  return ctx.provenance.entries.some((e) => e.draftId === record.id);
}

/** 検証の結果を下書きの状態に反映する。不採用は本文を持たず、保留は理由を足し、合格は ambiguous の保留を解く */
function applyVerification(record: DraftRecord, verification: Verification): DraftRecord {
  const base = record.reasons.filter((r) => !r.startsWith("verify:"));
  switch (verification.verdict) {
    case null:
      return { ...record, verification };
    case "pass": {
      const reasons = base.filter((r) => !r.startsWith("ambiguous:"));
      return { ...record, status: reasons.length === 0 ? "passed" : "held", reasons, verification };
    }
    case "hold":
      return {
        ...record,
        status: "held",
        reasons: [...new Set([...base, ...verification.reasons])].sort(),
        verification,
      };
    case "reject":
      return { ...record, status: "rejected", reasons: [...verification.reasons].sort(), draft: null, verification };
  }
}

const codesToReasons = (codes: readonly VerifyCode[]): string[] => [...new Set(codes)].sort().map(verifyReason);

function currentVerification(record: DraftRecord, evidence: string, stamp: AgentStamp): Verification | undefined {
  const v = record.verification;
  return v !== undefined && v.evidenceHash === evidence && v.agent?.definitionHash === stamp.definitionHash
    ? v
    : undefined;
}

function requestStep(ctx: Context): ExitCode {
  const { options, paths, facts, stamp } = ctx;
  const { config, rootDir, examCode, output, dryRun } = options;
  const cache = new BodyCache(paths.cacheDir, config.cache, Date.now);
  const attempts = readAttempts(paths.state);
  let records = ctx.drafts.drafts;
  let requested = 0;
  let current = 0;
  let pending = 0;
  let exhausted = 0;
  let missingSection = 0;
  let limited = false;
  let changed = false;
  const replace = (next: DraftRecord) => {
    records = records.map((r) => (r.id === next.id ? next : r));
    changed = true;
  };

  for (const record of [...records].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    if (!eligible(record, ctx) || record.draft === null) continue;
    const draft = record.draft;
    if (!isChoiceDraft(draft)) {
      // 自由記述は、選択肢の正誤を再導出する形が使えない。人が確かめる(承認があれば書き出せる)
      if (record.verification === undefined) {
        replace(
          applyVerification(record, {
            verdict: "hold",
            reasons: codesToReasons(["free-text-unchecked"]),
            findings: [],
            checks: {},
            agent: stamp,
          }),
        );
        report(output, "検証の保留", `${record.id} verify:free-text-unchecked`);
      }
      continue;
    }
    const found = collectSections(draft, facts, cache);
    if (!found.ok) {
      report(output, "検証の節なし", `${record.id} ${found.reason}`);
      missingSection++;
      continue;
    }
    const evidence = evidenceHash(found.sections, draft);
    const existing = currentVerification(record, evidence, stamp);
    if (existing?.verdict != null) {
      current++;
      continue;
    }
    // 写しは、モデルを呼ぶ前に落とす(依頼を出さない)
    if (
      existing === undefined &&
      draftTexts(draft).some(
        (t) =>
          detectCopy(
            t,
            found.sections.map((s) => s.text),
          ) !== null,
      )
    ) {
      replace(
        applyVerification(record, {
          verdict: "reject",
          reasons: codesToReasons(["copy"]),
          findings: [],
          checks: { copy: { result: "reject" } },
          evidenceHash: evidence,
          agent: stamp,
        }),
      );
      report(output, "検証の不採用", `${record.id} verify:copy`);
      continue;
    }
    const check = existing?.checks.rederive?.result === "pass" ? "explanation" : "rederive";
    const key = verifyKey(check, record.id, evidence, stamp.definitionHash);
    if ((attempts[key] ?? 0) >= config.verify.maxAttempts) {
      report(output, "再試行の上限", `${record.id} max-attempts`);
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
    const request = buildVerifyRequest({
      check,
      examCode,
      key,
      draftId: record.id,
      draft,
      sections: found.sections,
      evidence,
      outputPath: relative(rootDir, join(paths.outDir, `${key}.json`)),
      stamp,
    });
    if (!dryRun) writeJson(requestPath, request);
    report(output, "検証の依頼", relative(rootDir, requestPath));
    requested++;
  }
  report(output, "情報", `依頼 ${requested} 件、依頼済みで待っている ${pending} 件、検証済みで飛ばした ${current} 件`);
  if (dryRun) report(output, "書き込みをしない(dry-run)");
  else if (changed) writeDrafts(paths.drafts, { ...ctx.drafts, drafts: records });
  if (limited) report(output, "件数の上限", "maxItemsPerRun(再実行で続きから進む)");
  // 節を取り出せない下書きは、依頼を出さず止める(通す側に倒さない)
  return limited || exhausted > 0 || missingSection > 0 ? EXIT.checkFailed : EXIT.ok;
}

function importStep(ctx: Context): ExitCode {
  const { options, paths, facts, stamp } = ctx;
  const { config, output, dryRun } = options;
  const flow: FlowContext = { output, stopLabel: "検証の取り込みの停止", dryRun };
  const cache = new BodyCache(paths.cacheDir, config.cache, Date.now);
  const attempts = readAttempts(paths.state);
  let records = ctx.drafts.drafts;
  const doneFiles: string[] = [];
  const counts: Record<Verdict | "pending", number> = { pass: 0, hold: 0, reject: 0, pending: 0 };
  let failures = 0;
  let released = 0;

  for (const file of listRequestFiles(paths.requestsDir)) {
    const key = file.replace(/\.json$/, "");
    const outPath = join(paths.outDir, file);
    if (!existsSync(outPath)) {
      report(output, "検証の出力なし", key);
      continue;
    }
    const requestPath = join(paths.requestsDir, file);
    const parsedRequest = VerifyRequestSchema.safeParse(readJsonFile(requestPath));
    if (!parsedRequest.success || parsedRequest.data.requestKey !== key) {
      reportStop(flow, key, "request-invalid");
      failures++;
      continue;
    }
    const request = parsedRequest.data;
    const record = records.find((r) => r.id === request.draftId);
    // 依頼のあとに、定義・下書き・根拠の節・人の判断が変わった。出力の形を見る前に、依頼を作り直す
    const found = record?.draft ? collectSections(record.draft, facts, cache) : null;
    const stale =
      definitionChanged(request, stamp) ||
      record === undefined ||
      !eligible(record, ctx) ||
      found === null ||
      !found.ok ||
      record.draft === null ||
      evidenceHash(found.sections, record.draft) !== request.evidenceHash ||
      !isRequestNeeded(record, request, stamp);
    if (stale) {
      discardStale(flow, key, requestPath, outPath);
      continue;
    }
    const fail = (reason: string) => {
      failOutput(flow, key, reason, outPath, attempts);
      failures++;
    };
    const raw = readJsonFile(outPath);
    let verification: Verification;
    if (request.check === "rederive") {
      const parsed = RederiveOutputSchema.safeParse(raw);
      if (!parsed.success) {
        fail("output-invalid");
        continue;
      }
      const correct = record?.draft && isChoiceDraft(record.draft) ? record.draft.correctAnswers : [];
      const checked = checkRederiveOutput(request, parsed.data, correct);
      if (!checked.ok) {
        fail(checked.reason);
        continue;
      }
      const result = checked.codes.length === 0 ? "pass" : "hold";
      verification = {
        verdict: result === "pass" ? null : "hold",
        reasons: codesToReasons(checked.codes),
        findings: [],
        checks: {
          copy: { result: "pass" },
          rederive: { result, choices: checked.choices },
        },
        evidenceHash: request.evidenceHash,
        agent: stamp,
      };
    } else {
      const parsed = ExplanationOutputSchema.safeParse(raw);
      if (!parsed.success) {
        fail("output-invalid");
        continue;
      }
      const checked = checkExplanationOutput(request, parsed.data);
      if (!checked.ok) {
        fail(checked.reason);
        continue;
      }
      const before = record?.verification as Verification;
      const findings = checked.findings;
      const hold = findings.length > 0;
      verification = {
        ...before,
        verdict: hold ? "hold" : "pass",
        reasons: codesToReasons(findings.map((f) => f.code)),
        findings,
        checks: { ...before.checks, explanation: { result: hold ? "hold" : "pass" } },
      };
    }
    const next = applyVerification(record as DraftRecord, verification);
    if ((record as DraftRecord).status === "held" && next.status === "passed") released++;
    records = records.map((r) => (r.id === next.id ? next : r));
    counts[verification.verdict ?? "pending"]++;
    const where = verification.reasons.join(",");
    if (verification.verdict === "pass") report(output, "検証の合格", next.id);
    else if (verification.verdict === "hold") report(output, "検証の保留", `${next.id} ${where}`);
    else if (verification.verdict === "reject") report(output, "検証の不採用", `${next.id} ${where}`);
    doneFiles.push(file);
  }

  report(
    output,
    "情報",
    `取り込み: 合格 ${counts.pass} 件、保留 ${counts.hold} 件、不採用 ${counts.reject} 件、解説の確認待ち ${counts.pending} 件、保留を解いた ${released} 件、停止 ${failures} 件`,
  );
  if (dryRun) {
    report(output, "書き込みをしない(dry-run)");
    return failures > 0 ? EXIT.checkFailed : EXIT.ok;
  }
  if (doneFiles.length > 0) writeDrafts(paths.drafts, { ...ctx.drafts, drafts: records });
  writeJson(paths.state, attempts);
  cleanupImported(doneFiles, paths.requestsDir, paths.outDir);
  return failures > 0 ? EXIT.checkFailed : EXIT.ok;
}

/** その依頼が、いまの検証の状態から見て必要か(すでに取り込み済みの検査の依頼は、不要) */
function isRequestNeeded(record: DraftRecord, request: VerifyRequest, stamp: AgentStamp): boolean {
  const v = record.verification;
  const current =
    v !== undefined && v.evidenceHash === request.evidenceHash && v.agent?.definitionHash === stamp.definitionHash;
  if (request.check === "rederive") return !current;
  return current && v.verdict === null && v.checks.rederive?.result === "pass";
}
