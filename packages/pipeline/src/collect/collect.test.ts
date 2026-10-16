import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT } from "../exit-codes.ts";
import { factsPath, writeFacts } from "../facts/schema.ts";
import { main } from "../main.ts";
import { Fetcher, sha256 } from "./fetcher.ts";
import { emptyLedger, readLedger, serializeLedger } from "./ledger.ts";
import { entry, type FakeResponse, fakeNet, fixture, ROBOTS_OK, testFetchConfig } from "./test-helpers.ts";

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
    expect(readdirSync(cacheDir)).toContain(`${sha256(Buffer.from(fixture("guide.html")))}.body`);
    const ledgerText = readFileSync(join(root, config.ledgerDir, "aws-aib-c01.json"), "utf8");
    const reportText = readFileSync(join(root, config.workDir, "collect/aws-aib-c01/report.json"), "utf8");
    for (const text of [ledgerText, reportText, r.out, r.err]) expect(text).not.toContain("Synthetic");
    // 止めた出典があるので、検査の失敗で終わる。理由コードを出す
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain(`出典の検査: ${TWO} liveness fail dead-link`);
    // 試験ガイドの抽出を依頼する
    expect(r.out).toContain("試験ガイドの抽出の依頼: pipeline-work/guide/aws-aib-c01.request.json");
    const request = JSON.parse(readFileSync(join(root, config.workDir, "guide/aws-aib-c01.request.json"), "utf8"));
    expect(request.bodyPath).toMatch(/^pipeline-work\/cache\/[0-9a-f]{64}\.body$/);
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
      anchor: { heading: "h", quote: "q" },
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

describe("collect --import-guide", () => {
  async function collected() {
    const root = setupRoot({ ...plan, scope: { prefixes: [BASE], maxDepth: 0 } });
    await run(root, ["collect", CODE]);
    return root;
  }

  function writeExtract(root: string, domains: unknown) {
    const hash = sha256(Buffer.from(fixture("guide.html")));
    writeFileSync(
      join(root, config.workDir, "guide/aws-aib-c01.extract.json"),
      JSON.stringify({ examCode: CODE, sourceUrl: GUIDE, contentHash: hash, domains }),
    );
  }

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
    const pageHash = sha256(Buffer.from(fixture("doc.html")));
    expect(request.pages).toEqual([
      { url: ONE, contentHash: pageHash, bodyPath: `pipeline-work/cache/${pageHash}.body` },
    ]);
    const hash = sha256(Buffer.from(fixture("guide.html")));
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

  it("配点の合計が合わない・抽出がない_取り込みを止め、理由コードを出す", async () => {
    const root = await collected();
    expect((await run(root, ["collect", CODE, "--import-guide"])).err).toContain("extract-not-found");
    writeExtract(root, [{ number: 1, name: "分野 1", weightPercent: 90, scope: [] }]);
    const r = await run(root, ["collect", CODE, "--import-guide"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("試験ガイドの取り込みの停止: weight-sum-mismatch");
    expect(r.ledger().guide).toBeNull();
  });
});
