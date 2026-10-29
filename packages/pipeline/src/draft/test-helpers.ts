import { cpSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { BodyCache } from "../collect/cache.ts";
import { emptyLedger, ledgerPath, writeLedger } from "../collect/ledger.ts";
import { entry } from "../collect/test-helpers.ts";
import { emptyFacts, type FactCard, factsPath, writeFacts } from "../facts/schema.ts";
import { card, DOC_HASH, DOC_URL, factsFixture } from "../facts/test-helpers.ts";
import { main } from "../main.ts";
import { installAgentDefinitions, withoutExamSettings } from "../shared/test-helpers.ts";
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

/** 下書きに、検証の合格を記録する(検証の段階を通ったものとして扱う) */
export function markVerified(root: string, id: string, verdict: "pass" | "hold" = "pass"): void {
  const path = join(root, baseConfig.workDir, "draft", EXAM.toLowerCase(), "drafts.json");
  const file = JSON.parse(readFileSync(path, "utf8"));
  file.drafts = file.drafts.map((d: { id: string }) =>
    d.id === id ? { ...d, verification: { verdict, reasons: [], findings: [], checks: {} } } : d,
  );
  writeFileSync(path, JSON.stringify(file));
}
const repoRoot = resolve(import.meta.dirname, "../../../..");
export const baseConfig = withoutExamSettings(
  JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8")),
  EXAM,
);

/** 各分野に通過した事実カードが 1 件ずつある作業ディレクトリ */
export function setupDraftRoot(options: { cards?: FactCard[]; questions?: unknown } = {}) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-draft-"));
  mkdirSync(join(root, "data"));
  cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
  installAgentDefinitions(root);
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
  // 事実カードは、台帳の出典から抽出済み(出題計画は、未処理の出典が残ると止まる)
  writeFacts(factsPath(join(root, baseConfig.factsDir), EXAM), {
    ...emptyFacts(EXAM),
    extracted: [{ url: DOC_URL, contentHash: DOC_HASH }],
    cards,
  });
  // 事実カードの根拠の出典が、台帳にある
  writeLedger(ledgerPath(join(root, baseConfig.ledgerDir), EXAM), {
    ...emptyLedger(EXAM),
    sources: [entry({ url: DOC_URL, contentHash: DOC_HASH, fetchedAt: "2026-10-01" })],
  });
  // 根拠の出典の本文が、作業用のキャッシュにある(下書きの写しの検査に使う)
  new BodyCache(join(root, baseConfig.workDir, "cache"), baseConfig.cache).write(
    Buffer.from(factsFixture("service-doc.html")),
  );
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
  // 依頼の並びは鍵(定義のハッシュを含む)の順で、定義を変えると変わる。[0] に頼るテストが単一選択を得るよう、単一選択を先にする
  return readRequests(root)
    .filter((q) => q.kind !== "free-text")
    .sort((a, b) => Number(b.kind === "single") - Number(a.kind === "single"));
}

/** 自由記述の依頼に対する、通る下書き */
export function freeTextDraftFor(request: DraftRequest, overrides: Partial<FreeTextDraft> = {}): FreeTextDraft {
  return freeTextDraft({ factIds: [(request.facts[0] as DraftRequest["facts"][number]).id], ...overrides });
}

// ---- fixture とスタブ ----

/** fixture を読む */
export function draftFixture<T>(name: string): T {
  return JSON.parse(readFileSync(join(import.meta.dirname, "fixtures", name), "utf8")) as T;
}

/** fixture の事実カード(通過済み。根拠の出典は、台帳にある架空の出典) */
export function fixtureCards(): FactCard[] {
  const { facts } = draftFixture<{ facts: { id: string; domain: string; claim: string }[] }>("facts.json");
  return facts.map((f) => card({ id: f.id, domain: f.domain, claim: f.claim }));
}

/** fixture の公開済みの問題を、データの形にする */
export function fixturePublished() {
  const { questions } = draftFixture<{
    questions: {
      questionId: string;
      domain: string;
      questionType: "single";
      difficulty: "easy" | "medium" | "hard";
      questionText: string;
      choices: string[];
      correctAnswers: string[];
    }[];
  }>("published.json");
  return {
    examCode: EXAM,
    questions: questions.map((q) => ({
      questionId: q.questionId,
      examCode: EXAM,
      domain: q.domain,
      questionType: q.questionType,
      difficulty: q.difficulty,
      questionText: q.questionText,
      choices: q.choices.map((text, i) => ({ key: String.fromCharCode(65 + i), text })),
      correctAnswers: q.correctAnswers,
      explanation: "架空の解説です。",
    })),
  };
}

/**
 * モデルの代わりに依頼へ答えるスタブ。依頼の種別と事実カードに合わせ、fixture の話題から下書きを作って出力に書く。
 * 通信もモデルも使わない。書いた依頼の数を返す。
 */
export function stubAgent(root: string, start = 0): number {
  const { topics } = draftFixture<{ topics: string[] }>("stub.json");
  let n = start;
  for (const request of readRequests(root)) {
    const drafts: Draft[] = [];
    for (let i = 0; i < request.count; i++, n++) {
      const topic = topics[n % topics.length] as string;
      const factId = (request.facts[i % request.facts.length] as DraftRequest["facts"][number]).id;
      drafts.push(
        stubDraft(request.kind, `${topic}${Math.floor(n / topics.length) > 0 ? ` その${n}` : ""}`, n, factId),
      );
    }
    writeOutput(root, request, drafts);
  }
  return readRequests(root).length;
}

function stubDraft(kind: DraftRequest["kind"], topic: string, n: number, factId: string): Draft {
  const explanation = `${topic}について、依頼の事実カードの主張にもとづいて、正答の理由を説明します。ほかの選択肢は、適用範囲や数値が異なります。`;
  if (kind === "free-text") {
    return {
      questionType: "free-text",
      questionText: `${topic}について、仕組みと注意点を説明してください。`,
      rubric: {
        criteria: [
          { name: `${topic}の仕組み`, keywords: [`仕組み${n}`, "動作"], points: 50 },
          { name: `${topic}の注意点`, keywords: [`注意${n}`, "制限"], points: 50 },
        ],
        passingPoints: 60,
      },
      explanation,
      factIds: [factId],
    };
  }
  const base = {
    questionText:
      kind === "multiple"
        ? `${topic}に関する説明として、正しいものを 2 つ選択してください。`
        : `${topic}に関する説明として、正しいものはどれですか。`,
    explanation,
    factIds: [factId],
    distractors: [
      { key: "A", type: "misconception" as const, reason: "既定の設定を取り違えた誤りです", basis: { factId } },
      { key: "C", type: "condition-reversal" as const, reason: "条件を逆に述べた誤りです", basis: { factId } },
      {
        key: "D",
        type: "scope-difference" as const,
        reason: "対象の範囲が異なる誤りです",
        basis: { scope: "別の機能の説明" },
      },
    ],
  };
  const choices = [
    { key: "A", text: `既定では無効になっていて、手動で有効にする必要がある${n}` },
    { key: "B", text: `既定で ${20 + n} 件に制限されている` },
    { key: "C", text: `上限を持たず、いくつでも利用できる${n}` },
    { key: "D", text: `管理者の権限を持つ利用者だけが参照できる${n}` },
  ];
  if (kind === "multiple") {
    return {
      ...base,
      questionType: "multiple",
      choices: [...choices, { key: "E", text: `どの設定でも変更できない仕様である${n}` }],
      correctAnswers: ["B", "E"],
    };
  }
  return { ...base, questionType: "single", choices, correctAnswers: ["B"] };
}
