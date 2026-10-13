import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { emptyFacts, type FactCard, factsPath, writeFacts } from "../facts/schema.ts";
import { card } from "../facts/test-helpers.ts";
import { main } from "../main.ts";
import type { DraftRequest } from "./request.ts";
import type { ChoiceDraft } from "./schema.ts";
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
export function writeOutput(root: string, request: DraftRequest, drafts: ChoiceDraft[], overrides: object = {}) {
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
  return { ...base, factIds: [(request.facts[0] as DraftRequest["facts"][number]).id], ...overrides };
}
