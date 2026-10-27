import { cpSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { emptyLedger, ledgerPath, writeLedger } from "../collect/ledger.ts";
import { entry } from "../collect/test-helpers.ts";
import { type DecisionsFile, decisionsPath, writeDecisions } from "../decisions/decisions.ts";
import type { FactCard } from "../facts/schema.ts";
import { card, DOC_HASH, DOC_URL } from "../facts/test-helpers.ts";
import { readCriteria } from "../judge/criteria.ts";
import { contentHash, inputFromDraft } from "../judge/input.ts";
import { goodQuestion } from "../judge/test-helpers.ts";
import { readAgentStamp } from "../shared/agents.ts";
import { provenancePath, writeProvenance } from "./provenance.ts";
import type { DraftRequest } from "./request.ts";
import type { ChoiceDraft } from "./schema.ts";
import { type DraftRecord, readDrafts } from "./store.ts";
import {
  baseConfig,
  draftFor,
  EXAM,
  markVerified,
  runMain,
  setupDraftRoot,
  workPath,
  writeOutput,
} from "./test-helpers.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");

/** 書き直しの対象の問題の ID(非公開のファイルにある) */
export const REWRITE_ID = "AIB-0001";
export const URL_OTHER = "https://docs.aws.amazon.com/guide/other.html";
export const HASH_OTHER = "b".repeat(64);
/** 元の根拠(論点 1、出典 DOC_URL)、同じ論点・同じ出典、別の論点・同じ出典、同じ論点・別の出典 */
export const FACT_OWN = "f-00000000000a";
export const FACT_SAME = "f-00000000000b";
export const FACT_TOPIC = "f-00000000000c";
export const FACT_SOURCE = "f-00000000000d";

const otherSource = (c: FactCard): FactCard => ({
  ...c,
  sources: c.sources.map((s) => ({ ...s, url: URL_OTHER, contentHash: HASH_OTHER })),
});

/** 正解の位置をずらした公開の問題(正解の位置の偏りの検査に触れないように) */
function published(n: number) {
  const base = goodQuestion(n);
  const shift = n % 4;
  const choices = base.choices.map((c, i) => ({ ...c, text: base.choices[(i + shift) % 4]?.text ?? c.text }));
  const answer = choices.find((c) => c.text === base.choices[0]?.text)?.key ?? "A";
  return { ...base, choices, correctAnswers: [answer] };
}

/** 非公開の問題(判定: 書き直しで復帰できる)。正答は B */
export function originalQuestion(overrides: Record<string, unknown> = {}) {
  return {
    questionId: REWRITE_ID,
    examCode: EXAM,
    domain: "domain1",
    questionType: "single",
    questionText: "Widget Store のバケットの数について、正しい記述はどれですか。",
    choices: [
      { key: "A", text: "10 個まで" },
      { key: "B", text: "100 個まで" },
      { key: "C", text: "1,000 個まで" },
      { key: "D", text: "上限はない" },
    ],
    correctAnswers: ["B"],
    explanation: "Widget Store では、アカウントがリージョンごとに作れるバケットは 100 個までです。",
    references: [{ url: DOC_URL, title: "Service guide" }],
    ...overrides,
  };
}

/**
 * 書き直しの作業ディレクトリ(一時)。資格マスタ(AIB だけ、出題数 3)、判定の基準の文書、公開の問題 5 問、
 * 非公開の問題 1 問(判定は rewritable)、元の根拠の来歴、事実カード 4 枚(元の根拠、同じ論点と出典、別の論点、別の出典)を置く
 */
export function setupRewriteRoot(
  options: { verdict?: "rewritable" | "unpublish"; question?: Record<string, unknown> } = {},
) {
  const cards = [
    card({ id: FACT_OWN, domain: "domain1", scopeItems: [1], claim: "架空の主張 own" }),
    card({ id: FACT_SAME, domain: "domain1", scopeItems: [1], claim: "架空の主張 same" }),
    card({ id: FACT_TOPIC, domain: "domain1", scopeItems: [2], claim: "架空の主張 topic" }),
    otherSource(card({ id: FACT_SOURCE, domain: "domain1", scopeItems: [1], claim: "架空の主張 source" })),
  ];
  const root = setupDraftRoot({ cards });
  const exams = JSON.parse(readFileSync(join(root, "data/exams.json"), "utf8")) as {
    exams: { examCode: string; officialQuestionCount?: number }[];
  };
  exams.exams = exams.exams.filter((e) => e.examCode === EXAM).map((e) => ({ ...e, officialQuestionCount: 3 }));
  writeFileSync(join(root, "data/exams.json"), JSON.stringify(exams));
  mkdirSync(join(root, "docs/exam-style"), { recursive: true });
  cpSync(join(repoRoot, "docs/exam-style/aws-aib.md"), join(root, "docs/exam-style/aws-aib.md"));
  writeLedger(ledgerPath(join(root, baseConfig.ledgerDir), EXAM), {
    ...emptyLedger(EXAM),
    sources: [
      entry({ url: DOC_URL, contentHash: DOC_HASH, fetchedAt: "2026-10-01" }),
      entry({ url: URL_OTHER, contentHash: HASH_OTHER, fetchedAt: "2026-10-01" }),
    ],
  });
  writeFileSync(
    join(root, "data/questions.aws-aib-c01.json"),
    JSON.stringify({ examCode: EXAM, questions: [2, 3, 4, 5, 6].map(published) }),
  );
  writeFileSync(
    join(root, "data/unpublished.aws-aib-c01.json"),
    JSON.stringify({
      examCode: EXAM,
      entries: [
        {
          verdict: options.verdict ?? "rewritable",
          reasons: ["judge:choices-weak"],
          question: originalQuestion(options.question),
        },
      ],
    }),
  );
  writeProvenance(provenancePath(join(root, baseConfig.provenanceDir), EXAM), {
    examCode: EXAM,
    entries: [
      {
        draftId: "d-0000000000aa",
        questionId: REWRITE_ID,
        factIds: [FACT_OWN],
        sources: [{ url: DOC_URL, fetchedAt: "2026-10-01", contentHash: DOC_HASH }],
      },
    ],
  });
  return root;
}

export const rewriteRequests = (root: string): DraftRequest[] =>
  readRequestsOf(root).filter((r) => r.rewrite !== undefined);

function readRequestsOf(root: string): DraftRequest[] {
  const dir = workPath(root, "requests");
  try {
    return readdirSyncSorted(dir).map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as DraftRequest);
  } catch {
    return [];
  }
}

const readdirSyncSorted = (dir: string) =>
  readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort();

/** 書き直しの下書きの本文。元の問題と同じ正答の位置(B)で、設問文を言い換える */
export const REWRITTEN_TEXT =
  "Widget Store で、1 つのアカウントがリージョンごとに作れるバケットは、最大でいくつですか。";

/** 書き直しの依頼を書き、出力を書いて、取り込む。取り込んだ下書きの記録を返す */
export async function rewriteAndImport(
  root: string,
  draft: (request: DraftRequest) => ChoiceDraft = (request) => draftFor(request, { questionText: REWRITTEN_TEXT }),
): Promise<DraftRecord> {
  await runMain(root, ["draft", EXAM, "--rewrite"]);
  const request = rewriteRequests(root)[0] as DraftRequest;
  writeOutput(root, request, [draft(request)]);
  await runMain(root, ["draft", EXAM, "--import"]);
  const records = readDrafts(workPath(root, "drafts.json"), EXAM).drafts.filter((d) => d.rewriteOf === REWRITE_ID);
  return records[records.length - 1] as DraftRecord;
}

/** 人の承認を記録する */
export function approve(root: string, id: string): void {
  const path = decisionsPath(join(root, baseConfig.decisionsDir), EXAM);
  const file: DecisionsFile = {
    examCode: EXAM,
    decisions: [{ target: "draft", id, decision: "approve", reason: "reviewed" }],
  };
  writeDecisions(path, file);
}

/** 書き直した下書きの判定の結果を書く(公開の問題の判定は持たない)。overrides で、判定や各種ハッシュを変える */
export function writeRewriteJudgement(
  root: string,
  record: DraftRecord,
  overrides: { verdict?: "publish" | "rewritable" | "unpublish"; contentHash?: string; criteriaHash?: string } = {},
): void {
  const criteria = readCriteria(root, EXAM);
  const input = inputFromDraft(REWRITE_ID, record.draft as ChoiceDraft);
  const verdict = overrides.verdict ?? "publish";
  const reasons = verdict === "publish" ? [] : ["judge:choices-weak"];
  const dir = join(root, baseConfig.workDir, "judge", EXAM.toLowerCase());
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "results.json"),
    JSON.stringify({
      examCode: EXAM,
      entries: [
        {
          questionId: REWRITE_ID,
          contentHash: overrides.contentHash ?? contentHash(input),
          criteriaHash: overrides.criteriaHash ?? criteria?.hash,
          verdict,
          reasons,
          findings: reasons.map((r) => ({ code: r.replace("judge:", ""), where: "questionText" })),
          machine: { total: 100, lost: [], candidate: false },
          agent: readAgentStamp(root, "question-judge"),
        },
      ],
    }),
  );
}

/** 書き直しの下書きを、検証済み・承認済み・判定が公開、にする */
export async function readyToRestore(root: string): Promise<DraftRecord> {
  const record = await rewriteAndImport(root);
  markVerified(root, record.id);
  approve(root, record.id);
  const after = readDrafts(workPath(root, "drafts.json"), EXAM).drafts.find((d) => d.id === record.id) as DraftRecord;
  writeRewriteJudgement(root, after);
  return after;
}
