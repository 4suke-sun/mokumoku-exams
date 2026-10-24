import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyLedger, ledgerPath, writeLedger } from "../collect/ledger.ts";
import { entry } from "../collect/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { requestKey } from "../facts/extract.ts";
import { emptyFacts, factsPath, writeFacts } from "../facts/schema.ts";
import { DOC_HASH, DOC_URL } from "../facts/test-helpers.ts";
import { main } from "../main.ts";
import { readAgentStamp } from "../shared/agents.ts";
import { installAgentDefinitions } from "../shared/test-helpers.ts";
import { planPath, readPlan } from "./schema.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8"));
const CODE = "AWS-AIB-C01";

function setupRoot(questions?: unknown) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-planrun-"));
  mkdirSync(join(root, "data"));
  cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
  if (questions !== undefined) {
    writeFileSync(join(root, "data/questions.aws-aib-c01.json"), JSON.stringify(questions));
  }
  return root;
}

async function run(root: string, argv: string[]) {
  const configPath = join(root, "pipeline.config.json");
  writeFileSync(configPath, JSON.stringify(config));
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
  return { code, out, err, plan: () => readPlan(planPath(join(root, config.workDir), CODE)) };
}

function question(id: number, domain: string, difficulty: "easy" | "medium" | "hard") {
  return {
    questionId: `AIB-${String(id).padStart(4, "0")}`,
    examCode: CODE,
    domain,
    questionType: "single",
    difficulty,
    questionText: `架空の設問 ${id}`,
    choices: [
      { key: "A", text: "選択肢 A" },
      { key: "B", text: "選択肢 B" },
    ],
    correctAnswers: ["A"],
    explanation: "架空の解説",
  };
}

describe("plan コマンド", () => {
  it("問題データがない_目標どおりの計画を書く", async () => {
    const root = setupRoot();
    const r = await run(root, ["plan", CODE]);
    expect(r.code).toBe(EXIT.ok);
    const plan = r.plan();
    expect(plan?.targetTotal).toBe(255);
    expect(plan?.items.reduce((a, i) => a + i.count, 0)).toBe(255);
    expect(r.out).toContain("出題計画: domain1 目標 61 件");
  });

  it("既存の問題がある_その分を引いた不足を書く", async () => {
    const root = setupRoot({
      examCode: CODE,
      questions: [question(1, "domain1", "easy"), question(2, "domain1", "medium")],
    });
    const r = await run(root, ["plan", CODE]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.plan()?.domains[0]).toMatchObject({ domain: "domain1", existing: 2, missing: 59 });
  });

  it("実行しても_data の問題データは変わらない", async () => {
    const root = setupRoot({ examCode: CODE, questions: [question(1, "domain1", "easy")] });
    const file = join(root, "data/questions.aws-aib-c01.json");
    const before = readFileSync(file, "utf8");
    await run(root, ["plan", CODE]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("--dry-run_何も書かない", async () => {
    const root = setupRoot();
    const r = await run(root, ["plan", CODE, "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(existsSync(planPath(join(root, config.workDir), CODE))).toBe(false);
    expect(r.out).toContain("書き込みをしない(dry-run)");
  });

  it("問題データが壊れている_検査の失敗で止まり_本文を出さない", async () => {
    const root = setupRoot({ examCode: CODE, questions: [{ questionId: "secret-looking-text" }] });
    const r = await run(root, ["plan", CODE]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("問題データの誤り");
    expect(r.err).not.toContain("secret-looking-text");
  });

  it("資格コードの指定がない_入力の誤り", async () => {
    const r = await run(setupRoot(), ["plan"]);
    expect(r.code).toBe(EXIT.inputError);
  });

  it("資格マスタにない資格コード_入力の誤り", async () => {
    const r = await run(setupRoot(), ["plan", "AWS-ZZZ-C01"]);
    expect(r.code).toBe(EXIT.inputError);
  });

  it("近日公開の資格_入力の誤り", async () => {
    const exams = JSON.parse(readFileSync(join(repoRoot, "data/exams.json"), "utf8")) as {
      exams: { examCode: string; status: string }[];
    };
    const soon = exams.exams.find((e) => e.status === "coming-soon");
    expect(soon).toBeDefined();
    const r = await run(setupRoot(), ["plan", soon?.examCode ?? ""]);
    expect(r.code).toBe(EXIT.inputError);
  });
});

describe("plan コマンドの入口の検査", () => {
  const FACT_AGENT = readAgentStamp(repoRoot, "fact-extractor");

  /** 取得済みの出典が 1 件ある台帳を置く。extracted なら、その出典を今の定義で抽出済みにする */
  function setupWithSource(extracted: boolean) {
    const root = setupRoot();
    installAgentDefinitions(root);
    writeLedger(ledgerPath(join(root, config.ledgerDir), CODE), {
      ...emptyLedger(CODE),
      sources: [entry({ url: DOC_URL, contentHash: DOC_HASH })],
    });
    writeFacts(factsPath(join(root, config.factsDir), CODE), {
      ...emptyFacts(CODE),
      extracted: extracted ? [{ url: DOC_URL, contentHash: DOC_HASH, agent: FACT_AGENT }] : [],
    });
    return root;
  }

  it("事実カードを抽出していない出典が残る_計画を書かずに止める", async () => {
    const root = setupWithSource(false);
    const r = await run(root, ["plan", CODE]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain(`事実カードの未処理: ${DOC_URL}`);
    expect(r.err).toContain("事実カードの未処理: 出典 1 件");
    expect(existsSync(planPath(join(root, config.workDir), CODE))).toBe(false);
  });

  it("出典をすべて抽出済み_計画を書く", async () => {
    const root = setupWithSource(true);
    const r = await run(root, ["plan", CODE]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.plan()).not.toBeNull();
  });

  it("抽出していない出典が再試行の上限に達している_止めずに計画を書く", async () => {
    const root = setupWithSource(false);
    const key = requestKey(DOC_URL, DOC_HASH, FACT_AGENT.definitionHash);
    const stateDir = join(root, config.workDir, "facts", CODE.toLowerCase());
    mkdirSync(stateDir, { recursive: true });
    writeFileSync(join(stateDir, "state.json"), JSON.stringify({ [key]: config.facts.maxAttempts }));
    const r = await run(root, ["plan", CODE]);
    expect(r.code, r.err).toBe(EXIT.ok);
  });
});
