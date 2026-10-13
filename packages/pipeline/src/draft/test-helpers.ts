import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { emptyLedger, ledgerPath, writeLedger } from "../collect/ledger.ts";
import { entry } from "../collect/test-helpers.ts";
import { emptyFacts, type FactCard, factsPath, writeFacts } from "../facts/schema.ts";
import { card, DOC_HASH, DOC_URL } from "../facts/test-helpers.ts";
import { main } from "../main.ts";
import type { DraftRequest } from "./request.ts";
import type { ChoiceDraft, Draft, FreeTextDraft } from "./schema.ts";
import { draftWorkDir } from "./store.ts";

/** 通る下書き(テスト用の既定値。架空のサービス Widget Store の内容) */
export function choiceDraft(overrides: Partial<ChoiceDraft> = {}): ChoiceDraft {
  return {
    questionType: "single",
    questionText: "Widget Store で、1 つのアカウントがリージョンごとに作れるバケットの上限数はどれですか。",
    choices: [
      { key: "A", text: "10 個" },
      { key: "B", text: "100 個" },
      { key: "C", text: "1,000 個" },
      { key: "D", text: "上限はない" },
    ],
    correctAnswers: ["B"],
    explanation: "Widget Store では、アカウントがリージョンごとに作れるバケットは 100 個までと定められています。",
    factIds: ["f-aaaaaaaaaaaa"],
    distractors: [
      {
        key: "A",
        type: "numeric-difference",
        reason: "上限の数値が実際より小さい誤りです",
        basis: { factId: "f-aaaaaaaaaaaa" },
      },
      {
        key: "C",
        type: "numeric-difference",
        reason: "上限の数値が実際より大きい誤りです",
        basis: { factId: "f-aaaaaaaaaaaa" },
      },
      {
        key: "D",
        type: "misconception",
        reason: "上限が定められていることを見落とした誤解です",
        basis: { factId: "f-aaaaaaaaaaaa" },
      },
    ],
    ...overrides,
  };
}

/** 通る自由記述の下書き */
export function freeTextDraft(overrides: Partial<FreeTextDraft> = {}): FreeTextDraft {
  return {
    questionType: "free-text",
    questionText: "Widget Store のバケットに上限がある理由と、上限を超えるときの対処を説明してください。",
    rubric: {
      criteria: [
        { name: "上限の存在", keywords: ["上限", "100 個"], points: 50 },
        { name: "超えるときの対処", keywords: ["申請", "引き上げ"], points: 50 },
      ],
      passingPoints: 60,
    },
    explanation:
      "バケットはアカウントとリージョンごとに 100 個までと定められており、超える場合は上限の引き上げを申請します。",
    factIds: ["f-aaaaaaaaaaaa"],
    ...overrides,
  };
}

/** 複数選択の下書き */
export function multipleDraft(overrides: Partial<ChoiceDraft> = {}): ChoiceDraft {
  return choiceDraft({
    questionType: "multiple",
    questionText: "Widget Store のバケットについて正しい説明を 2 つ選択してください。",
    choices: [
      { key: "A", text: "バケット名は、リージョンの中で一意でなければならない" },
      { key: "B", text: "バケットは、作成後に別のリージョンへ移せる" },
      { key: "C", text: "アカウントあたりの上限は、リージョンごとに数えられる" },
      { key: "D", text: "バケットには、オブジェクトを入れずに作成できる" },
      { key: "E", text: "バケットを作ると、自動で公開状態になる" },
    ],
    correctAnswers: ["A", "C"],
    distractors: [
      {
        key: "B",
        type: "misconception",
        reason: "リージョンを移せるという誤解です",
        basis: { factId: "f-aaaaaaaaaaaa" },
      },
      {
        key: "D",
        type: "condition-reversal",
        reason: "作成の条件を逆に述べた誤りです",
        basis: { factId: "f-aaaaaaaaaaaa" },
      },
      {
        key: "E",
        type: "misconception",
        reason: "公開状態が既定だという誤解です",
        basis: { factId: "f-aaaaaaaaaaaa" },
      },
    ],
    ...overrides,
  });
}

// ---- コマンドを通して確かめるための補助 ----

export const EXAM = "AWS-AIB-C01";
const repoRoot = resolve(import.meta.dirname, "../../../..");
export const baseConfig = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8"));

/** 各分野に通過した事実カードが 1 件ずつある作業ディレクトリ */
export function setupDraftRoot(options: { cards?: FactCard[]; questions?: unknown } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-draft-"));
  mkdirSync(join(root, "data"));
  cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
  if (options.questions !== undefined) {
    writeFileSync(join(root, "data/questions.aws-aib-c01.json"), JSON.stringify(options.questions));
  }
  const cards =
    options.cards ??
    [1, 2, 3, 4].map((n) =>
      card({
        id: `f-${String(n).repeat(12)}`.replace(/[^f0-9a-f-]/g, "a"),
        domain: `domain${n}`,
        claim: `架空の主張 ${n}`,
      }),
    );
  writeFacts(factsPath(join(root, baseConfig.factsDir), EXAM), { ...emptyFacts(EXAM), cards });
  // 事実カードの根拠の出典が、台帳にある
  writeLedger(ledgerPath(join(root, baseConfig.ledgerDir), EXAM), {
    ...emptyLedger(EXAM),
    sources: [entry({ url: DOC_URL, contentHash: DOC_HASH, fetchedAt: "2026-10-01" })],
  });
  return root;
}

export async function runMain(root: string, argv: string[], overrides: Record<string, unknown> = {}) {
  const configPath = join(root, "pipeline.config.json");
  writeFileSync(configPath, JSON.stringify({ ...baseConfig, maxItemsPerRun: 100, ...overrides }));
  let out = "";
  let err = "";
  const code = await main({
    argv,
    env: {},
    output: {
      out: (t) => {
        out += t;
      },
      err: (t) => {
        err += t;
      },
    },
    configPath,
    rootDir: root,
  });
  return { code, out, err };
}

export function workPath(root: string, ...parts: string[]): string {
  return join(draftWorkDir(join(root, baseConfig.workDir), EXAM), ...parts);
}

export function readRequests(root: string): DraftRequest[] {
  const dir = workPath(root, "requests");
  try {
    return readdirSync(dir)
      .filter((f) => f.endsWith(".json"))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(dir, f), "utf8")) as DraftRequest);
  } catch {
    return [];
  }
}

/** 依頼の outputPath に、中身をそのまま書く */
export function writeRaw(root: string, request: DraftRequest, content: string) {
  const path = join(root, request.outputPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, content);
}

/** 依頼に対するエージェントの出力を、依頼の outputPath に書く */
export function writeOutput(root: string, request: DraftRequest, drafts: Draft[], overrides: object = {}) {
  const path = join(root, request.outputPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      examCode: request.examCode,
      requestKey: request.requestKey,
      planItemId: request.planItemId,
      drafts,
      ...overrides,
    }),
  );
}

/** 依頼の事実カードを根拠にした、通る下書き。種別は依頼に合わせる */
export function draftFor(request: DraftRequest, overrides: Partial<ChoiceDraft> = {}): ChoiceDraft {
  const base = request.kind === "multiple" ? multipleDraft() : choiceDraft();
  const factId = (request.facts[0] as DraftRequest["facts"][number]).id;
  // 誤答の根拠も、依頼の事実カードに合わせる
  const distractors = (base.distractors ?? []).map((d) => ("factId" in d.basis ? { ...d, basis: { factId } } : d));
  return { ...base, factIds: [factId], distractors, ...overrides };
}

/** 選択式の依頼だけ(自由記述の依頼を除く) */
export function readChoiceRequests(root: string): DraftRequest[] {
  return readRequests(root).filter((q) => q.kind !== "free-text");
}

/** 自由記述の依頼に対する、通る下書き */
export function freeTextDraftFor(request: DraftRequest, overrides: Partial<FreeTextDraft> = {}): FreeTextDraft {
  return freeTextDraft({ factIds: [(request.facts[0] as DraftRequest["facts"][number]).id], ...overrides });
}
