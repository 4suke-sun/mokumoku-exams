import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contentHashOf } from "../collect/content-hash.ts";
import { Fetcher } from "../collect/fetcher.ts";
import { ledgerPath, readLedger, writeLedger } from "../collect/ledger.ts";
import { type FakeResponse, fakeNet, fixture, ROBOTS_OK, testFetchConfig } from "../collect/test-helpers.ts";
import { draftWorkDir, readDrafts } from "../draft/store.ts";
import { stubAgent } from "../draft/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { requestKey } from "../facts/extract.ts";
import { factsPath, readFacts } from "../facts/schema.ts";
import { factsFixture } from "../facts/test-helpers.ts";
import { main } from "../main.ts";
import { installAgentDefinitions, repoDefinitionHash } from "../shared/test-helpers.ts";

/**
 * 収集から書き出しまでの通し。ネットワークとモデルを使わない(取得は固定の応答、エージェントの出力はテストがファイルとして書く)。
 * 一時ディレクトリで動かし、実際の data/ を変えない。
 */

const CODE = "AWS-AIB-C01";
const BASE = "https://docs.aws.amazon.com/guide/";
const GUIDE = `${BASE}index.html`;
const DOC = `${BASE}service.html`;
const repoRoot = resolve(import.meta.dirname, "../../../..");
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8"));
const singleOnly = { plan: { ...config.plan, typeMix: { single: 1, multiple: 0, "free-text": 0 } } };

const routes: Record<string, FakeResponse> = {
  "https://docs.aws.amazon.com/robots.txt": ROBOTS_OK,
  [GUIDE]: { body: fixture("guide.html") },
  [DOC]: { body: factsFixture("service-doc.html") },
};

function published(count: number) {
  return Array.from({ length: count }, (_, i) => {
    const text = `公開済みの架空の設問 ${i + 1} 番`;
    return {
      questionId: `AIB-${String(i + 1).padStart(4, "0")}`,
      examCode: CODE,
      domain: "domain2",
      questionType: "single",
      questionText: text,
      choices: ["A", "B", "C", "D"].map((key) => ({ key, text: `${text} の選択肢 ${key}` })),
      correctAnswers: ["ABCD"[i % 4] as string],
      explanation: `${text} の解説です。正解の理由を説明します。`,
    };
  });
}

function setupRoot(plan: unknown) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-e2e-"));
  mkdirSync(join(root, "data"));
  cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
  installAgentDefinitions(root);
  cpSync(join(repoRoot, "data/questions.ex-smp-xx.json"), join(root, "data/questions.ex-smp-xx.json"));
  cpSync(join(repoRoot, "data/questions.aws-clf-c02.json"), join(root, "data/questions.aws-clf-c02.json"));
  cpSync(join(repoRoot, "data/questions.aws-dva-c02.json"), join(root, "data/questions.aws-dva-c02.json"));
  writeFileSync(
    join(root, "data/questions.aws-aib-c01.json"),
    JSON.stringify({ examCode: CODE, questions: published(90) }),
  );
  mkdirSync(join(root, config.plansDir), { recursive: true });
  writeFileSync(join(root, config.plansDir, "aws-aib-c01.json"), JSON.stringify(plan));
  return root;
}

const plan = {
  examCode: CODE,
  sources: [
    { url: GUIDE, kind: "exam-guide" },
    { url: DOC, kind: "official-doc" },
  ],
  scope: { prefixes: [BASE], maxDepth: 0 },
  exclude: [],
};

async function run(root: string, argv: string[], netRoutes = routes) {
  const configPath = join(root, "pipeline.config.json");
  writeFileSync(configPath, JSON.stringify({ ...config, ...singleOnly }));
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
    collectDeps: {
      fetcher: new Fetcher(testFetchConfig, fakeNet(netRoutes).deps),
      today: () => "2026-10-13",
      now: () => Date.parse("2026-10-13"),
    },
  });
  return { code, out, err };
}

const work = (root: string, ...parts: string[]) => join(root, config.workDir, ...parts);

/** エージェントの代わりに、試験ガイドの抽出を書く */
function writeGuide(root: string) {
  writeFileSync(
    work(root, "guide/aws-aib-c01.extract.json"),
    JSON.stringify({
      examCode: CODE,
      sourceUrl: GUIDE,
      contentHash: contentHashOf(Buffer.from(fixture("guide.html"))),
      pages: [],
      domains: [
        { number: 1, name: "分野 1", weightPercent: 24, scope: ["上限の数え方"] },
        { number: 2, name: "分野 2", weightPercent: 28, scope: ["範囲 2"] },
        { number: 3, name: "分野 3", weightPercent: 24, scope: ["範囲 3"] },
        { number: 4, name: "分野 4", weightPercent: 24, scope: ["範囲 4"] },
      ],
    }),
  );
}

const goodCard = {
  claim: "Widget Store では、1 つのアカウントがリージョンごとに持てるバケットは 100 個まで。",
  section: "Quotas and limits",
  anchor: { heading: "quotas", quote: "up to 100 buckets per account" },
  confidence: "high",
  domain: "domain1",
  scopeItems: [0],
};
const encryptionCard = {
  claim: "Widget Store では、新しいバケットの保存時の暗号化が、既定で有効になっている。",
  section: "Encryption",
  anchor: { heading: "security", quote: "Encryption at rest is enabled by default" },
  confidence: "high",
  domain: "domain1",
  scopeItems: [0],
};
/** 本文を写した主張(不採用になる) */
const copiedCard = {
  ...goodCard,
  claim: "A Widget Store holds up to 100 buckets per account in each region. と書かれている。",
};
/** 本文にない数値を含む主張(不採用になる) */
const wrongNumberCard = { ...goodCard, claim: "Widget Store では、バケットは 250 個まで。" };

/** エージェントの代わりに、事実カードの抽出を書く */
function writeFacts(root: string, cards: unknown[]) {
  const hash = contentHashOf(Buffer.from(factsFixture("service-doc.html")));
  const dir = work(root, "facts/aws-aib-c01/out");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${requestKey(DOC, hash, repoDefinitionHash("fact-extractor"))}.json`),
    JSON.stringify({ examCode: CODE, sourceUrl: DOC, contentHash: hash, cards }),
  );
}

/** エージェントの代わりに、検証役の出力を書く。再導出は下書きの宣言どおりに、解説の確認は指摘なしにする */
function stubVerifier(root: string) {
  const dir = work(root, "verify/aws-aib-c01");
  const draftsFile = readDrafts(join(draftWorkDir(work(root), CODE), "drafts.json"), CODE).drafts;
  mkdirSync(join(dir, "out"), { recursive: true });
  for (const file of existsSync(join(dir, "requests")) ? readdirSync(join(dir, "requests")) : []) {
    const request = JSON.parse(readFileSync(join(dir, "requests", file), "utf8"));
    const outPath = join(dir, "out", file);
    if (existsSync(outPath)) continue;
    const base = { examCode: CODE, requestKey: request.requestKey, draftId: request.draftId, check: request.check };
    if (request.check === "rederive") {
      const draft = draftsFile.find((d) => d.id === request.draftId)?.draft;
      const correct = draft !== null && draft !== undefined && "correctAnswers" in draft ? draft.correctAnswers : [];
      writeFileSync(
        outPath,
        JSON.stringify({
          ...base,
          judgements: request.choices.map((c: { key: string }) => ({
            key: c.key,
            judgement: correct.includes(c.key) ? "correct" : "incorrect",
            evidence: { heading: request.sections[0].heading, summary: "節の内容と整合する(言い換え)" },
          })),
        }),
      );
    } else {
      writeFileSync(outPath, JSON.stringify({ ...base, findings: [] }));
    }
  }
}

/** 検証: 再導出 → 取り込み → 解説の確認 → 取り込み */
async function verifyAll(root: string) {
  for (let round = 0; round < 2; round++) {
    expect((await run(root, ["verify", CODE])).code).toBe(EXIT.ok);
    stubVerifier(root);
    expect((await run(root, ["verify", CODE, "--import"])).code).toBe(EXIT.ok);
  }
}

/** 人の確認: 表とシートを出し、シートの全件を承認して取り込む */
async function approveAll(root: string) {
  await run(root, ["draft", CODE, "--review"]);
  const sheetPath = join(draftWorkDir(work(root), CODE), "review-sheet.json");
  const sheet = JSON.parse(readFileSync(sheetPath, "utf8")) as { items: { id: string }[] };
  writeFileSync(
    sheetPath,
    JSON.stringify({
      examCode: CODE,
      items: sheet.items.map((i) => ({ id: i.id, decision: "approve", reason: "reviewed" })),
    }),
  );
  return run(root, ["draft", CODE, "--decide"]);
}

/** 収集 → 試験ガイドの取り込み → 事実カード → 出題計画 → 下書きの取り込みまで進める */
async function throughDrafts(root: string, cards: unknown[] = [goodCard, encryptionCard, copiedCard, wrongNumberCard]) {
  await run(root, ["collect", CODE]);
  writeGuide(root);
  expect((await run(root, ["collect", CODE, "--import-guide"])).code).toBe(EXIT.ok);
  await run(root, ["facts", CODE]);
  writeFacts(root, cards);
  await run(root, ["facts", CODE, "--import"]);
  expect((await run(root, ["plan", CODE])).code).toBe(EXIT.ok);
  await run(root, ["draft", CODE, "--domain=domain1"]);
  stubAgent(root);
  const imported = await run(root, ["draft", CODE, "--import"]);
  await verifyAll(root);
  return imported;
}

describe("収集から書き出しまでの通し", () => {
  it("固定の入力_承認した下書きが書き出され、データの検査に通り、再実行しても差分が増えない", async () => {
    const root = setupRoot(plan);
    const imported = await throughDrafts(root);
    expect(imported.code).toBe(EXIT.ok);
    // 本文の写しと、本文にない数値の主張は、事実カードで不採用になり、下書きの根拠にならない
    const facts = readFacts(factsPath(join(root, config.factsDir), CODE), CODE);
    expect(facts.cards.filter((c) => c.status === "passed")).toHaveLength(2);
    const rejectedReasons = facts.cards.filter((c) => c.status === "rejected").flatMap((c) => c.reasons);
    expect(rejectedReasons).toEqual(expect.arrayContaining(["long-copy", "number-mismatch"]));
    // 試験ガイドのページは、事実カードの抽出の対象にならない
    expect(readdirSync(work(root, "facts/aws-aib-c01/requests"), { withFileTypes: true }).length).toBe(0);

    expect((await run(root, ["draft", CODE, "--check"])).code).toBe(EXIT.ok);
    const drafts = readDrafts(join(draftWorkDir(work(root), CODE), "drafts.json"), CODE).drafts;
    const passed = drafts.filter((d) => d.status === "passed");
    expect(passed.length).toBeGreaterThan(0);
    // 承認の前は、何も書き出さない
    const before = await run(root, ["export", CODE]);
    expect(before.out).toContain(`追加 0 件、承認待ち ${passed.length} 件`);

    // 承認は、保留の下書きの保留も解く。書き出すのは、承認した(通過になった)下書きの全件
    await approveAll(root);
    const approved = readDrafts(join(draftWorkDir(work(root), CODE), "drafts.json"), CODE).drafts.filter(
      (d) => d.status === "passed",
    ).length;
    const exported = await run(root, ["export", CODE]);
    expect(exported.code).toBe(EXIT.ok);
    expect(exported.out).toContain(`追加 ${approved} 件`);
    const data = JSON.parse(readFileSync(join(root, "data/questions.aws-aib-c01.json"), "utf8"));
    expect(data.questions).toHaveLength(90 + approved);
    expect(data.questions.at(-1).questionId).toBe(`AIB-${String(90 + approved).padStart(4, "0")}`);
    // 出典の題は、台帳の公式ページの題(取得した本文の title 要素)
    expect(data.questions.at(-1).references).toEqual([{ url: DOC, title: "Synthetic service guide" }]);

    // 同じ入力で各段階を再実行しても、依頼と書き出しの差分が増えない
    const snapshot = readFileSync(join(root, "data/questions.aws-aib-c01.json"), "utf8");
    expect((await run(root, ["facts", CODE])).out).toContain("依頼 0 件");
    // 計画の残りの分の依頼は出るが、同じ入力でもう一度実行しても、依頼は増えない
    await run(root, ["draft", CODE, "--domain=domain1"]);
    expect((await run(root, ["draft", CODE, "--domain=domain1"])).out).toContain("依頼 0 件");
    expect((await run(root, ["export", CODE])).out).toContain("追加 0 件");
    expect(readFileSync(join(root, "data/questions.aws-aib-c01.json"), "utf8")).toBe(snapshot);
  });

  it("出典のドメインが許可外_収集の段階で止まり、先へ進まない", async () => {
    const root = setupRoot({ ...plan, sources: [{ url: "https://unlisted.example.com/guide/", kind: "exam-guide" }] });
    const r = await run(root, ["collect", CODE]);
    expect(r.code).not.toBe(EXIT.ok);
    expect(readLedger(ledgerPath(join(root, config.ledgerDir), CODE), CODE).sources).toEqual([]);
  });

  it("事実カードが保留(矛盾)_人の判断の記録がないと、下書きの依頼の根拠にならない", async () => {
    const root = setupRoot(plan);
    const conflicting = {
      ...goodCard,
      claim: goodCard.claim.replace("100", "5"),
      anchor: { heading: "quotas", quote: "as large as 5 TB" },
    };
    await throughDrafts(root, [goodCard, conflicting]);
    const facts = readFacts(factsPath(join(root, config.factsDir), CODE), CODE);
    expect(facts.cards.every((c) => c.status === "held")).toBe(true);
    const dir = join(draftWorkDir(work(root), CODE), "requests");
    expect(existsSync(dir) ? readdirSync(dir) : []).toEqual([]);
  });

  it("再検証の印が付いた事実カード_それを根拠にした下書きは、承認があっても書き出さない", async () => {
    const root = setupRoot(plan);
    await throughDrafts(root);
    await approveAll(root);
    const path = ledgerPath(join(root, config.ledgerDir), CODE);
    const facts = readFacts(factsPath(join(root, config.factsDir), CODE), CODE);
    const passedIds = facts.cards.filter((c) => c.status === "passed").map((c) => c.id);
    writeLedger(path, { ...readLedger(path, CODE), recheck: { facts: passedIds, questions: [] } });
    const exported = await run(root, ["export", CODE]);
    expect(exported.out).toContain("追加 0 件");
    expect(exported.out).toMatch(/来歴の検査で止めた [1-9]/);
  });
});
