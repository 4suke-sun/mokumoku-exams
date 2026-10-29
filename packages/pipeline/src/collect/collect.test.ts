import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionsPath, writeDecisions } from "../decisions/decisions.ts";
import { EXIT } from "../exit-codes.ts";
import { factsPath, writeFacts } from "../facts/schema.ts";
import { main } from "../main.ts";
import { readAgentStamp } from "../shared/agents.ts";
import { installAgentDefinitions } from "../shared/test-helpers.ts";
import { contentHashOf } from "./content-hash.ts";
import { Fetcher } from "./fetcher.ts";
import { emptyLedger, readLedger, serializeLedger } from "./ledger.ts";
import {
  entry,
  type FakeResponse,
  fakeNet,
  fixture,
  ROBOTS_OK,
  syntheticPdf,
  testFetchConfig,
} from "./test-helpers.ts";

const CODE = "AWS-AIB-C01";
const BASE = "https://docs.aws.amazon.com/guide/";
const GUIDE = `${BASE}index.html`;
const ONE = `${BASE}detail/one.html`;
const TWO = `${BASE}detail/two.html`;
const repoRoot = resolve(import.meta.dirname, "../../../..");
const config = {
  ...JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8")),
  maxItemsPerRun: 20,
};

const plan = {
  examCode: CODE,
  sources: [{ url: GUIDE, kind: "exam-guide" }],
  scope: { prefixes: [BASE], maxDepth: 1 },
  exclude: [`${BASE}private/`],
};

const routes: Record<string, FakeResponse> = {
  "https://docs.aws.amazon.com/robots.txt": ROBOTS_OK,
  [GUIDE]: { body: fixture("guide.html") },
  [ONE]: { body: fixture("doc.html") },
  [TWO]: { status: 404 },
};

function setupRoot(planContent: unknown = plan) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-collect-"));
  mkdirSync(join(root, "data"));
  cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
  installAgentDefinitions(root);
  mkdirSync(join(root, config.plansDir), { recursive: true });
  writeFileSync(join(root, config.plansDir, "aws-aib-c01.json"), JSON.stringify(planContent));
  return root;
}

async function run(
  root: string,
  argv: string[],
  netRoutes: Record<string, FakeResponse> = routes,
  overrides: Record<string, unknown> = {},
  today = "2026-10-13",
) {
  const net = fakeNet(netRoutes);
  const configPath = join(root, "pipeline.config.json");
  writeFileSync(configPath, JSON.stringify({ ...config, ...overrides }));
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
    collectDeps: { fetcher: new Fetcher(testFetchConfig, net.deps), today: () => today, now: () => Date.parse(today) },
  });
  return { code, out, err, net, ledger: () => readLedger(join(root, config.ledgerDir, "aws-aib-c01.json"), CODE) };
}

describe("collect", () => {
  it("計画に沿って、取得・キャッシュ・台帳の更新・検査を順に行う", async () => {
    const root = setupRoot();
    const r = await run(root, ["collect", CODE]);
    // 範囲の外・除外・許可外のホストは取得しない
    expect(r.net.requests.filter((u) => !u.endsWith("robots.txt")).sort()).toEqual([ONE, TWO, GUIDE].sort());
    const ledger = r.ledger();
    const status = Object.fromEntries(ledger.sources.map((s) => [s.url, s.status]));
    expect(status).toEqual({ [GUIDE]: "active", [ONE]: "active", [TWO]: "unreachable" });
    expect(ledger.sources.find((s) => s.url === GUIDE)?.kind).toBe("exam-guide");
    expect(ledger.sources.find((s) => s.url === GUIDE)?.updatedAt).toBe("2026-06-01");
    // 本文はキャッシュにだけあり、台帳と報告にはない
    const cacheDir = join(root, config.workDir, "cache");
    expect(readdirSync(cacheDir)).toContain(`${contentHashOf(Buffer.from(fixture("guide.html")))}.body`);
    const ledgerText = readFileSync(join(root, config.ledgerDir, "aws-aib-c01.json"), "utf8");
    const reportText = readFileSync(join(root, config.workDir, "collect/aws-aib-c01/report.json"), "utf8");
    for (const text of [ledgerText, reportText, r.out, r.err]) {
      expect(text).not.toContain("Domain 1: Alpha topics");
      expect(text).not.toContain("Synthetic text without an update date");
    }
    // 題(`<title>`)は台帳に持つ。本文は持たない
    expect(ledger.sources.find((s) => s.url === GUIDE)?.title).toBe("Synthetic exam guide");
    expect(ledger.sources.find((s) => s.url === ONE)?.title).toBe("Synthetic doc");
    expect(ledger.sources.find((s) => s.url === TWO)?.title).toBeUndefined();
    // 止めた出典があるので、検査の失敗で終わる。理由コードを出す
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain(`出典の検査: ${TWO} liveness fail dead-link`);
    // 試験ガイドの抽出を依頼する
    expect(r.out).toContain("試験ガイドの抽出の依頼: pipeline-work/guide/aws-aib-c01.request.json");
    const request = JSON.parse(readFileSync(join(root, config.workDir, "guide/aws-aib-c01.request.json"), "utf8"));
    expect(request.bodyPath).toMatch(/^pipeline-work\/cache\/[0-9a-f]{64}\.body$/);
  });

  it("版を持つ準備中の資格_出典の対象に、資格マスタの版を付ける", async () => {
    const root = setupRoot();
    const path = join(root, "data/exams.json");
    const exams = JSON.parse(readFileSync(path, "utf8"));
    exams.exams = exams.exams.map((e: { examCode: string }) =>
      e.examCode === CODE
        ? {
            examCode: CODE,
            status: "coming-soon",
            vendor: "AWS",
            name: "準備中",
            shortName: "準備中",
            edition: "C01",
            idPrefix: "AIB",
          }
        : e,
    );
    writeFileSync(path, JSON.stringify(exams));
    const r = await run(root, ["collect", CODE]);
    const targets = r.ledger().sources.map((s) => s.target.edition);
    expect(targets.length).toBeGreaterThan(0);
    expect(targets.every((e) => e === "C01")).toBe(true);
  });

  it("途中で止まった実行_再実行で、今日取得済みのものを飛ばして続きから進む", async () => {
    const root = setupRoot();
    const all = { ...routes, [TWO]: { body: fixture("doc.html") } };
    const first = await run(root, ["collect", CODE], all, { maxItemsPerRun: 1 });
    expect(first.code).toBe(EXIT.checkFailed);
    expect(first.err).toContain("件数の上限");
    expect(first.ledger().sources.map((s) => s.url)).toEqual([GUIDE]);
    const second = await run(root, ["collect", CODE], all);
    expect(second.net.requests).not.toContain(GUIDE);
    expect(
      second
        .ledger()
        .sources.map((s) => s.url)
        .sort(),
    ).toEqual([ONE, TWO, GUIDE].sort());
    expect(second.code).toBe(EXIT.ok);
  });

  it("本文が変わった出典_事実カードに再検証の印を付け、変化として報告する", async () => {
    const root = setupRoot({ ...plan, scope: { prefixes: [BASE], maxDepth: 0 } });
    const before = {
      ...emptyLedger(CODE),
      sources: [
        entry({
          url: GUIDE,
          kind: "exam-guide",
          fetchedAt: "2026-09-01",
          contentHash: "0".repeat(64),
          claims: [{ id: "c1", paraphrase: "言い換え", quotes: [], factRefs: ["f1"] }],
        }),
      ],
    };
    mkdirSync(join(root, config.ledgerDir), { recursive: true });
    writeFileSync(join(root, config.ledgerDir, "aws-aib-c01.json"), serializeLedger(before));
    const r = await run(root, ["collect", CODE]);
    expect(r.out).toContain(`出典の変化: ${GUIDE} 2026-09-01 → 2026-10-13 active`);
    expect(r.ledger().recheck.facts).toEqual(["f1"]);
    // 言い換えは残る
    expect(r.ledger().sources[0]?.claims).toHaveLength(1);
  });

  it("飾りだけが変わった出典の取り直し_ハッシュが変わらず、再検証の印も変化の報告も付かない", async () => {
    const root = setupRoot({ ...plan, scope: { prefixes: [BASE], maxDepth: 0 } });
    const first = await run(root, ["collect", CODE]);
    const hash = first.ledger().sources[0]?.contentHash;
    expect(hash).toBe(contentHashOf(Buffer.from(fixture("guide.html"))));
    const ledgerFile = join(root, config.ledgerDir, "aws-aib-c01.json");
    const withClaim = first.ledger();
    writeFileSync(
      ledgerFile,
      serializeLedger({
        ...withClaim,
        sources: withClaim.sources.map((s) => ({
          ...s,
          claims: [{ id: "c1", paraphrase: "言い換え", quotes: [], factRefs: ["f1"] }],
        })),
      }),
    );
    // head のタイトルと更新日のメタ、本文の外のコメントだけが変わる
    const decorated = fixture("guide.html")
      .replace("Synthetic exam guide</title>", "Synthetic exam guide (updated)</title>")
      .replace('content="2026-06-01"', 'content="2026-10-14"')
      .replace("</body>", "<!-- generated 2026-10-14 --></body>");
    expect(decorated).not.toBe(fixture("guide.html"));
    const second = await run(root, ["collect", CODE], { ...routes, [GUIDE]: { body: decorated } }, {}, "2026-10-14");
    expect(second.ledger().sources[0]?.contentHash).toBe(hash);
    expect(second.ledger().recheck).toEqual({ facts: [], questions: [] });
    expect(second.out + second.err).not.toContain("出典の変化");
  });

  it("本文が変わった出典_来歴をたどって根拠にした下書きの件数を報告し_下書きには印を持たせない", async () => {
    const root = setupRoot({ ...plan, scope: { prefixes: [BASE], maxDepth: 0 } });
    const before = {
      ...emptyLedger(CODE),
      sources: [
        entry({
          url: GUIDE,
          kind: "exam-guide",
          fetchedAt: "2026-09-01",
          contentHash: "0".repeat(64),
          claims: [{ id: "c1", paraphrase: "言い換え", quotes: [], factRefs: ["f-aaaaaaaaaaaa"] }],
        }),
      ],
    };
    mkdirSync(join(root, config.ledgerDir), { recursive: true });
    writeFileSync(join(root, config.ledgerDir, "aws-aib-c01.json"), serializeLedger(before));
    const source = { url: GUIDE, fetchedAt: "2026-09-01", contentHash: "0".repeat(64) };
    mkdirSync(join(root, config.provenanceDir), { recursive: true });
    writeFileSync(
      join(root, config.provenanceDir, "aws-aib-c01.json"),
      JSON.stringify({
        examCode: CODE,
        entries: [
          { draftId: "d-aaaaaaaaaaaa", factIds: ["f-aaaaaaaaaaaa"], sources: [source] },
          { draftId: "d-bbbbbbbbbbbb", factIds: ["f-bbbbbbbbbbbb"], sources: [source] },
        ],
      }),
    );
    const r = await run(root, ["collect", CODE]);
    expect(r.out + r.err).toContain("再検証の印: 事実カード 1 件、根拠にした下書き・問題 1 件");
    expect(r.ledger().recheck).toEqual({ facts: ["f-aaaaaaaaaaaa"], questions: [] });
  });

  it("日付が古いだけの出典に人が受け入れを記録した_根拠に使える状態になり、本文が変わると再び止まる", async () => {
    const root = setupRoot({ ...plan, scope: { prefixes: [BASE], maxDepth: 0 } });
    const strict = { checks: { ...config.checks, freshnessDays: 30 } };
    const before = await run(root, ["collect", CODE], routes, strict);
    expect(before.ledger().sources[0]?.status).not.toBe("active");
    expect(before.err).toContain(`出典の検査: ${GUIDE} freshness fail stale`);
    const hash = contentHashOf(Buffer.from(fixture("guide.html")));
    writeDecisions(decisionsPath(join(root, config.decisionsDir), CODE), {
      examCode: CODE,
      decisions: [{ target: "source", url: GUIDE, contentHash: hash, decision: "accept", reason: "stale-but-correct" }],
    });
    const accepted = await run(root, ["collect", CODE], routes, strict, "2026-10-14");
    expect(accepted.ledger().sources[0]?.status).toBe("active");
    // 検査の記録は不合格のまま残る(受け入れたことは、判断の記録が持つ)
    expect(accepted.ledger().sources[0]?.checks.find((c) => c.name === "freshness")?.result).toBe("fail");
    const changed = {
      ...routes,
      [GUIDE]: { body: fixture("guide.html").replace("Alpha topics", "Alpha topics changed") },
    };
    const after = await run(root, ["collect", CODE], changed, strict, "2026-10-15");
    expect(after.ledger().sources[0]?.status).not.toBe("active");
    expect(after.err).toContain(`判断の対象なし: source ${GUIDE}`);
  });

  it("本文が変わった出典を根拠にした事実カード_台帳の主張がなくても、再検証の印を付ける", async () => {
    const root = setupRoot({ ...plan, scope: { prefixes: [BASE], maxDepth: 0 } });
    mkdirSync(join(root, config.ledgerDir), { recursive: true });
    writeFileSync(
      join(root, config.ledgerDir, "aws-aib-c01.json"),
      serializeLedger({
        ...emptyLedger(CODE),
        sources: [entry({ url: GUIDE, kind: "exam-guide", fetchedAt: "2026-09-01", contentHash: "0".repeat(64) })],
      }),
    );
    const evidence = {
      url: GUIDE,
      section: "節",
      anchor: { heading: "h" },
      contentHash: "0".repeat(64),
    };
    const base = {
      claim: "言い換え",
      sources: [evidence],
      scope: {},
      confidence: "high" as const,
      domain: "domain1",
      scopeItems: [],
      reasons: [],
    };
    writeFacts(factsPath(join(root, config.factsDir), CODE), {
      examCode: CODE,
      extracted: [],
      cards: [
        { ...base, id: "f-live", status: "passed" },
        { ...base, id: "f-rejected", status: "rejected", reasons: ["x"] },
      ],
    });
    const r = await run(root, ["collect", CODE]);
    expect(r.ledger().recheck.facts).toEqual(["f-live"]);
  });

  it("計画が検査を通らない_通信せず、場所と理由コードだけを出す", async () => {
    const root = setupRoot({ ...plan, sources: [{ url: "https://unlisted.example.com/guide/", kind: "exam-guide" }] });
    const r = await run(root, ["collect", CODE]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.net.requests).toEqual([]);
    expect(r.err).toContain("計画の誤り: sources.0.url host-not-allowed");
    expect(r.err).not.toContain("unlisted.example.com");
  });

  it("dry-run_計画を検査するだけで、通信も書き込みもしない", async () => {
    const root = setupRoot();
    const r = await run(root, ["collect", CODE, "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.net.requests).toEqual([]);
    expect(existsSync(join(root, config.ledgerDir))).toBe(false);
    expect(existsSync(join(root, config.workDir))).toBe(false);
  });

  it("資格マスタにない資格_入力の誤り", async () => {
    const root = setupRoot();
    expect((await run(root, ["collect", "AWS-ZZZ-C01"])).code).toBe(EXIT.inputError);
  });
});

describe("collect の試験ガイドが PDF", () => {
  const PDF = `${BASE}guide.pdf`;
  const pdfPlan = { ...plan, sources: [{ url: PDF, kind: "exam-guide" }], scope: { prefixes: [BASE], maxDepth: 0 } };
  const pdfRoutes = { ...routes, [PDF]: { body: syntheticPdf("Section 1: Synthetic topics (100%)") } };

  it("PDF の試験ガイド_読めるようにしたテキストを付属のファイルに置き、依頼はそのテキストを指す", async () => {
    const root = setupRoot(pdfPlan);
    const r = await run(root, ["collect", CODE], pdfRoutes);
    expect(r.out).toContain("試験ガイドの抽出の依頼: pipeline-work/guide/aws-aib-c01.request.json");
    const request = JSON.parse(readFileSync(join(root, config.workDir, "guide/aws-aib-c01.request.json"), "utf8"));
    expect(request.bodyPath).toMatch(/^pipeline-work\/cache\/[0-9a-f]{64}\.txt$/);
    expect(readFileSync(join(root, request.bodyPath), "utf8")).toContain("Section 1: Synthetic topics");
  });

  it("PDF の試験ガイドの抽出_テキストと比べて取り込む", async () => {
    const root = setupRoot(pdfPlan);
    await run(root, ["collect", CODE], pdfRoutes);
    const request = JSON.parse(readFileSync(join(root, config.workDir, "guide/aws-aib-c01.request.json"), "utf8"));
    writeFileSync(
      join(root, config.workDir, "guide/aws-aib-c01.extract.json"),
      JSON.stringify({
        examCode: CODE,
        sourceUrl: PDF,
        contentHash: request.contentHash,
        domains: [{ number: 1, name: "分野 1", weightPercent: 100, scope: ["範囲の言い換え"] }],
      }),
    );
    const r = await run(root, ["collect", CODE, "--import-guide"], pdfRoutes);
    expect(r.code).toBe(EXIT.ok);
    expect(r.ledger().guide?.domains.map((d) => d.code)).toEqual(["domain1"]);
  });
});

describe("collect --import-guide", () => {
  async function collected() {
    const root = setupRoot({ ...plan, scope: { prefixes: [BASE], maxDepth: 0 } });
    await run(root, ["collect", CODE]);
    return root;
  }

  function writeExtract(root: string, domains: unknown, extra: Record<string, unknown> = {}) {
    const hash = contentHashOf(Buffer.from(fixture("guide.html")));
    writeFileSync(
      join(root, config.workDir, "guide/aws-aib-c01.extract.json"),
      JSON.stringify({ examCode: CODE, sourceUrl: GUIDE, contentHash: hash, domains, ...extra }),
    );
  }

  const oneDomain = [{ number: 1, name: "分野 1", weightPercent: 100, scope: [] }];

  it("検査を通った抽出_台帳に取り込み、マスタとの差分を報告する。マスタは書き換えない", async () => {
    const root = await collected();
    const masterBefore = readFileSync(join(root, "data/exams.json"), "utf8");
    writeExtract(root, [
      { number: 1, name: "分野 1", weightPercent: 20, scope: ["範囲の言い換え"] },
      { number: 2, name: "分野 2", weightPercent: 28, scope: [] },
      { number: 3, name: "分野 3", weightPercent: 24, scope: [] },
      { number: 4, name: "分野 4", weightPercent: 14, scope: [] },
      { number: 5, name: "分野 5", weightPercent: 14, scope: [] },
    ]);
    const r = await run(root, ["collect", CODE, "--import-guide"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.ledger().guide?.domains.map((d) => d.code)).toEqual([
      "domain1",
      "domain2",
      "domain3",
      "domain4",
      "domain5",
    ]);
    expect(r.out).toContain("試験ガイドの差分: マスタにない分野 domain5");
    expect(r.out).toContain("試験ガイドの差分: 配点のずれ domain1 ガイド 0.2 マスタ 0.24");
    expect(readFileSync(join(root, "data/exams.json"), "utf8")).toBe(masterBefore);
  });

  it("試験ガイドからたどったページと続きのページ_試験ガイドの種別になり、サービスの文書からたどったページは公式文書になる", async () => {
    const DOC = `${BASE}doc/service.html`;
    const THREE = `${BASE}detail/three.html`;
    const root = setupRoot({
      ...plan,
      sources: [...plan.sources, { url: DOC, kind: "official-doc" }],
      guidePages: [TWO],
    });
    const r = await run(root, ["collect", CODE], {
      ...routes,
      [DOC]: { body: fixture("doc.html") },
      [THREE]: { status: 404 },
    });
    const kinds = Object.fromEntries(r.ledger().sources.map((s) => [s.url, s.kind]));
    // ONE は試験ガイドからたどった付属のページ、TWO は続きのページ。THREE はサービスの文書からたどったページ
    expect(kinds).toEqual({
      [GUIDE]: "exam-guide",
      [ONE]: "exam-guide",
      [TWO]: "exam-guide",
      [DOC]: "official-doc",
      [THREE]: "official-doc",
    });
  });

  it("前の台帳と計画で種別が違う_収集のたびに計画から付け直す", async () => {
    const root = setupRoot({ ...plan, scope: { prefixes: [BASE], maxDepth: 0 }, guidePages: [ONE] });
    mkdirSync(join(root, config.ledgerDir), { recursive: true });
    writeFileSync(
      join(root, config.ledgerDir, "aws-aib-c01.json"),
      serializeLedger({
        ...emptyLedger(CODE),
        sources: [entry({ url: ONE, kind: "official-doc", fetchedAt: "2026-09-01" })],
      }),
    );
    const r = await run(root, ["collect", CODE]);
    expect(r.ledger().sources.find((s) => s.url === ONE)?.kind).toBe("exam-guide");
  });

  it("試験ガイドの続きのページ_深さ 0 でも取得し、依頼と取り込みに含める。ページが変わると依頼し直す", async () => {
    const root = setupRoot({ ...plan, scope: { prefixes: [BASE], maxDepth: 0 }, guidePages: [ONE] });
    const first = await run(root, ["collect", CODE]);
    expect(first.net.requests).toContain(ONE);
    const requestPath = join(root, config.workDir, "guide/aws-aib-c01.request.json");
    const request = JSON.parse(readFileSync(requestPath, "utf8"));
    const pageHash = contentHashOf(Buffer.from(fixture("doc.html")));
    expect(request.pages).toEqual([
      { url: ONE, contentHash: pageHash, bodyPath: `pipeline-work/cache/${pageHash}.body` },
    ]);
    const hash = contentHashOf(Buffer.from(fixture("guide.html")));
    writeFileSync(
      join(root, config.workDir, "guide/aws-aib-c01.extract.json"),
      JSON.stringify({
        examCode: CODE,
        sourceUrl: GUIDE,
        contentHash: hash,
        pages: [{ url: ONE, contentHash: pageHash }],
        domains: [{ number: 1, name: "分野 1", weightPercent: 100, scope: ["範囲の言い換え"] }],
      }),
    );
    expect((await run(root, ["collect", CODE, "--import-guide"])).code).toBe(EXIT.ok);
    expect(readLedger(join(root, config.ledgerDir, "aws-aib-c01.json"), CODE).guide?.pages).toEqual([
      { url: ONE, contentHash: pageHash },
    ]);
    // 取り込み済みで、どれも変わらなければ、依頼し直さない
    const same = await run(root, ["collect", CODE], routes, {}, "2026-10-14");
    expect(same.out).not.toContain("試験ガイドの抽出の依頼");
    // 続きのページだけが変わっても、依頼し直す
    const changed = { ...routes, [ONE]: { body: fixture("guide.html").replace("Synthetic", "Changed") } };
    const again = await run(root, ["collect", CODE], changed, {}, "2026-10-15");
    expect(again.out).toContain("試験ガイドの抽出の依頼");
  });

  it("ガイドが本番の値を示す_台帳に数値を記録し、マスタとの食い違いを項目の名前と両方の値で報告する(終了コードは 0)", async () => {
    const root = await collected();
    // マスタ(AIB): 出題数 85、試験時間 170、合格点 700、満点 1000
    writeExtract(root, oneDomain, {
      questionCount: 85,
      scoredQuestionCount: 65,
      timeMinutes: 180,
      passingScore: 700,
      totalScore: 1000,
    });
    const r = await run(root, ["collect", CODE, "--import-guide"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.ledger().guide?.exam).toEqual({
      questionCount: 85,
      scoredQuestionCount: 65,
      timeMinutes: 180,
      passingScore: 700,
      totalScore: 1000,
    });
    expect(r.out).toContain("試験ガイドの差分: 試験時間のずれ ガイド 180 マスタ 170");
    expect(r.out).not.toContain("出題数のずれ");
    expect(r.out).not.toContain("合格点のずれ");
    expect(r.out).toContain("ガイドが示す採点対象の問題数 65");
  });

  it("マスタに本番の値がない資格(準備中)_ガイドの値を、マスタにない項目として報告する", async () => {
    const root = await collected();
    const path = join(root, "data/exams.json");
    const exams = JSON.parse(readFileSync(path, "utf8"));
    exams.exams = exams.exams.map((e: { examCode: string }) =>
      e.examCode === CODE
        ? {
            examCode: CODE,
            status: "coming-soon",
            vendor: "AWS",
            name: "準備中",
            shortName: "準備中",
            domains: [{ code: "domain1", name: "分野 1", weight: 1 }],
          }
        : e,
    );
    writeFileSync(path, JSON.stringify(exams));
    writeExtract(root, oneDomain, { questionCount: 65, timeMinutes: 130 });
    const r = await run(root, ["collect", CODE, "--import-guide"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("試験ガイドの差分: マスタにない項目 出題数 ガイド 65");
    expect(r.out).toContain("試験ガイドの差分: マスタにない項目 試験時間 ガイド 130");
  });

  it("ガイドが本番の値を示さない_台帳に持たず、本番の値の差分も出さない", async () => {
    const root = await collected();
    writeExtract(root, oneDomain);
    const r = await run(root, ["collect", CODE, "--import-guide"]);
    expect(r.ledger().guide?.exam).toBeUndefined();
    expect(r.out).not.toMatch(/のずれ ガイド \d+ マスタ|マスタにない項目/);
  });

  it("合格点が満点を超える抽出_取り込みで止まり、台帳に入れない", async () => {
    const root = await collected();
    writeExtract(root, oneDomain, { passingScore: 1001, totalScore: 1000 });
    const r = await run(root, ["collect", CODE, "--import-guide"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("試験ガイドの取り込みの停止: exam-values-invalid");
    expect(r.ledger().guide).toBeNull();
  });

  it("試験ガイドの依頼と取り込み_定義の記録を依頼と台帳に残し、定義が変わると出し直す", async () => {
    const root = await collected();
    const requestPath = join(root, config.workDir, "guide/aws-aib-c01.request.json");
    const stamp = readAgentStamp(root, "guide-extractor");
    expect(JSON.parse(readFileSync(requestPath, "utf8")).agent).toEqual(stamp);
    writeExtract(root, [{ number: 1, name: "分野 1", weightPercent: 100, scope: [] }]);
    const imported = await run(root, ["collect", CODE, "--import-guide"]);
    expect(imported.ledger().guide?.agent).toEqual(stamp);
    expect((await run(root, ["collect", CODE])).out).not.toContain("試験ガイドの抽出の依頼");
    const path = join(root, ".claude", "agents", "guide-extractor.md");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n- 追加した指示\n`);
    const again = await run(root, ["collect", CODE], routes, {}, "2026-10-14");
    expect(again.out).toContain("試験ガイドの抽出の依頼");
    expect(JSON.parse(readFileSync(requestPath, "utf8")).agent.definitionHash).not.toBe(stamp.definitionHash);
  });

  it("依頼のあとに定義が変わった_抽出を取り込まず、依頼を作り直す", async () => {
    const root = await collected();
    writeExtract(root, [{ number: 1, name: "分野 1", weightPercent: 100, scope: [] }]);
    const path = join(root, ".claude", "agents", "guide-extractor.md");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n- 追加した指示\n`);
    const r = await run(root, ["collect", CODE, "--import-guide"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("試験ガイドの取り込みの停止: guide request-stale");
    expect(r.ledger().guide).toBeNull();
  });

  it("依頼のファイルが壊れている_request-invalid で止め、抽出を取り込まない", async () => {
    const root = await collected();
    writeExtract(root, [{ number: 1, name: "分野 1", weightPercent: 100, scope: [] }]);
    writeFileSync(join(root, config.workDir, "guide/aws-aib-c01.request.json"), "{壊れた");
    const r = await run(root, ["collect", CODE, "--import-guide"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("試験ガイドの取り込みの停止: guide request-invalid");
    expect(r.ledger().guide).toBeNull();
  });

  it("配点の合計が合わない・抽出がない_取り込みを止め、理由コードを出す", async () => {
    const root = await collected();
    expect((await run(root, ["collect", CODE, "--import-guide"])).err).toContain("extract-not-found");
    writeExtract(root, [{ number: 1, name: "分野 1", weightPercent: 90, scope: [] }]);
    const r = await run(root, ["collect", CODE, "--import-guide"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("試験ガイドの取り込みの停止: weight-sum-mismatch");
    expect(r.ledger().guide).toBeNull();
  });

  describe("題を足す(--titles)", () => {
    it("題のない台帳の出典_題のない出典だけを取得し、題以外の項目を変えない", async () => {
      const root = setupRoot();
      const first = await run(root, ["collect", CODE]);
      const ledgerFile = join(root, config.ledgerDir, "aws-aib-c01.json");
      const original = readLedger(ledgerFile, CODE);
      // 題を持つ出典と、取得に失敗した出典(題なし)を作る
      const stripped = {
        ...original,
        sources: original.sources.map((s) => {
          const { title: _title, ...rest } = s;
          return s.url === GUIDE ? s : rest;
        }),
      };
      writeFileSync(ledgerFile, serializeLedger(stripped));
      const second = await run(root, ["collect", CODE, "--titles"]);
      expect(first.code).toBe(EXIT.checkFailed);
      // 題のない 2 件だけを取得する(TWO は取れず、題なしのまま)
      expect(second.net.requests.filter((u) => !u.endsWith("robots.txt")).sort()).toEqual([ONE, TWO].sort());
      const after = second.ledger();
      expect(after.sources.find((s) => s.url === ONE)?.title).toBe("Synthetic doc");
      expect(after.sources.find((s) => s.url === TWO)?.title).toBeUndefined();
      expect(second.out).toContain(`題が取れない出典: ${TWO}`);
      expect(second.code).toBe(EXIT.checkFailed);
      // 題以外は変わらない
      for (const s of after.sources) {
        const { title: _t, ...rest } = s;
        const { title: _o, ...before } = original.sources.find((o) => o.url === s.url) as typeof s;
        expect(rest).toEqual(before);
      }
    });

    it("ドライラン_取得も書き込みもしない", async () => {
      const root = setupRoot();
      await run(root, ["collect", CODE]);
      const r = await run(root, ["collect", CODE, "--titles", "--dry-run"]);
      expect(r.net.requests).toEqual([]);
      expect(r.code).toBe(EXIT.ok);
    });
  });
});
