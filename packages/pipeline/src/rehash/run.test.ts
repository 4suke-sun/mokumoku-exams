import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { contentHashOf, rawSha256 } from "../collect/content-hash.ts";
import { Fetcher } from "../collect/fetcher.ts";
import { emptyLedger, ledgerPath, readLedger, writeLedger } from "../collect/ledger.ts";
import { entry, type FakeResponse, fakeNet, ROBOTS_OK, testFetchConfig } from "../collect/test-helpers.ts";
import { decisionsPath, readDecisions, writeDecisions } from "../decisions/decisions.ts";
import { provenancePath, readProvenance, writeProvenance } from "../draft/provenance.ts";
import { EXIT } from "../exit-codes.ts";
import { factsPath, readFacts, writeFacts } from "../facts/schema.ts";
import { card, DOC_HASH, DOC_URL, factsFixture } from "../facts/test-helpers.ts";
import { main } from "../main.ts";

const CODE = "AWS-AIB-C01";
const repoRoot = resolve(import.meta.dirname, "../../../..");
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8"));
const HTML = factsFixture("service-doc.html");
const OLD = rawSha256(Buffer.from(HTML));
const STALE = rawSha256(Buffer.from("古い本文"));

/** 旧い定義(生のバイト列のハッシュ)のハッシュを持つ記録と、その名前のキャッシュの本文を置く */
function setup(options: { cached?: boolean; staleEvidence?: boolean } = {}) {
  const { cached = true, staleEvidence = false } = options;
  const root = mkdtempSync(join(tmpdir(), "pipeline-rehash-"));
  mkdirSync(join(root, "data"));
  cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
  if (cached) {
    mkdirSync(join(root, config.workDir, "cache"), { recursive: true });
    writeFileSync(join(root, config.workDir, "cache", `${OLD}.body`), HTML);
  }
  const dir = (d: string) => resolve(root, d);
  writeLedger(ledgerPath(dir(config.ledgerDir), CODE), {
    ...emptyLedger(CODE),
    sources: [entry({ url: DOC_URL, contentHash: OLD })],
  });
  const evidenceHash = staleEvidence ? STALE : OLD;
  const base = card();
  writeFacts(factsPath(dir(config.factsDir), CODE), {
    examCode: CODE,
    extracted: [{ url: DOC_URL, contentHash: OLD }],
    cards: [{ ...base, sources: base.sources.map((s) => ({ ...s, contentHash: evidenceHash })) }],
  });
  writeProvenance(provenancePath(dir(config.provenanceDir), CODE), {
    examCode: CODE,
    entries: [
      {
        draftId: "d-aaaaaaaaaaaa",
        factIds: [base.id],
        sources: [{ url: DOC_URL, fetchedAt: "2026-10-01", contentHash: OLD }],
      },
    ],
  });
  writeDecisions(decisionsPath(dir(config.decisionsDir), CODE), {
    examCode: CODE,
    decisions: [{ target: "source", url: DOC_URL, contentHash: OLD, decision: "accept", reason: "stale-but-correct" }],
  });
  return root;
}

async function run(root: string, argv: string[], routes: Record<string, FakeResponse> = {}) {
  const net = fakeNet({ "https://docs.aws.amazon.com/robots.txt": ROBOTS_OK, ...routes });
  const configPath = join(root, "pipeline.config.json");
  writeFileSync(configPath, JSON.stringify(config));
  let out = "";
  let err = "";
  const code = await main({
    argv,
    env: {},
    output: { out: (t) => (out += t), err: (t) => (err += t) },
    configPath,
    rootDir: root,
    collectDeps: {
      fetcher: new Fetcher(testFetchConfig, net.deps),
      today: () => "2026-10-27",
      now: () => Date.parse("2026-10-27"),
    },
  });
  const dir = (d: string) => resolve(root, d);
  return {
    code,
    out,
    err,
    net,
    ledger: () => readLedger(ledgerPath(dir(config.ledgerDir), CODE), CODE),
    facts: () => readFacts(factsPath(dir(config.factsDir), CODE), CODE),
    provenance: () => readProvenance(provenancePath(dir(config.provenanceDir), CODE), CODE),
    decisions: () => readDecisions(decisionsPath(dir(config.decisionsDir), CODE), CODE),
    cacheHas: (hash: string) => existsSync(join(root, config.workDir, "cache", `${hash}.body`)),
  };
}

describe("rehash", () => {
  it("本文がキャッシュにある_台帳・事実カード・来歴・判断の記録が新しいハッシュへ移り、再検証の印は付かない", async () => {
    const root = setup();
    expect(DOC_HASH).not.toBe(OLD);
    const r = await run(root, ["rehash", CODE]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.ledger().sources[0]?.contentHash).toBe(DOC_HASH);
    expect(r.ledger().recheck).toEqual({ facts: [], questions: [] });
    expect(r.facts().extracted[0]?.contentHash).toBe(DOC_HASH);
    expect(r.facts().cards[0]?.sources[0]?.contentHash).toBe(DOC_HASH);
    expect(r.provenance().entries[0]?.sources[0]?.contentHash).toBe(DOC_HASH);
    expect(r.decisions().decisions[0]).toMatchObject({ target: "source", contentHash: DOC_HASH });
    expect(r.cacheHas(DOC_HASH)).toBe(true);
    expect(r.net.requests).toEqual([]);
  });

  it("移したあとにもう一度流す_何も変わらない", async () => {
    const root = setup();
    await run(root, ["rehash", CODE]);
    const ledgerFile = ledgerPath(resolve(root, config.ledgerDir), CODE);
    const before = readFileSync(ledgerFile, "utf8");
    const again = await run(root, ["rehash", CODE]);
    expect(again.code).toBe(EXIT.ok);
    expect(again.out).toContain("変換 0 件");
    expect(readFileSync(ledgerFile, "utf8")).toBe(before);
  });

  it("本文がキャッシュにない現在の出典_移さず、保留して検査の失敗で終わる", async () => {
    const root = setup({ cached: false });
    const r = await run(root, ["rehash", CODE]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain(`ハッシュの移行の保留: ${DOC_URL}`);
    expect(r.ledger().sources[0]?.contentHash).toBe(OLD);
    expect(r.net.requests).toEqual([]);
  });

  it("本文がない現在の出典に --refetch_取り直して、新しい定義のハッシュを採用する", async () => {
    const root = setup({ cached: false });
    const r = await run(root, ["rehash", CODE, "--refetch"], { [DOC_URL]: { body: HTML } });
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("取り直して採用 1 件");
    expect(r.ledger().sources[0]?.contentHash).toBe(DOC_HASH);
    expect(r.facts().cards[0]?.sources[0]?.contentHash).toBe(DOC_HASH);
    expect(r.cacheHas(DOC_HASH)).toBe(true);
    expect(r.ledger().recheck).toEqual({ facts: [], questions: [] });
  });

  it("移せる記録と、本文がなく移せない現在の出典が同時にある_移せた記録を書き換えてから、検査の失敗で終わる", async () => {
    const root = setup();
    const otherUrl = "https://docs.aws.amazon.com/guide/other.html";
    const otherHash = rawSha256(Buffer.from("キャッシュにない本文"));
    const ledgerFile = ledgerPath(resolve(root, config.ledgerDir), CODE);
    writeLedger(ledgerFile, {
      ...emptyLedger(CODE),
      sources: [entry({ url: DOC_URL, contentHash: OLD }), entry({ url: otherUrl, contentHash: otherHash })],
    });
    const r = await run(root, ["rehash", CODE]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain(`ハッシュの移行の保留: ${otherUrl}`);
    expect(r.ledger().sources.find((x) => x.url === DOC_URL)?.contentHash).toBe(DOC_HASH);
    expect(r.ledger().sources.find((x) => x.url === otherUrl)?.contentHash).toBe(otherHash);
  });

  it("--dry-run で本文がなく移せない現在の出典がある_報告して、終了コード 0 で終わる", async () => {
    const root = setup({ cached: false });
    const r = await run(root, ["rehash", CODE, "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.err).toContain(`ハッシュの移行の保留: ${DOC_URL}`);
    expect(r.ledger().sources[0]?.contentHash).toBe(OLD);
  });

  it("取り直しに失敗した現在の出典_採用せず、検査の失敗で終わる", async () => {
    const root = setup({ cached: false });
    const r = await run(root, ["rehash", CODE, "--refetch"], { [DOC_URL]: { status: 404 } });
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.ledger().sources[0]?.contentHash).toBe(OLD);
  });

  it("現在のハッシュと違う古い根拠で本文がない_今の本文のハッシュに寄せず、据え置く", async () => {
    const root = setup({ staleEvidence: true });
    const r = await run(root, ["rehash", CODE]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("古い根拠のため据え置き 1 件");
    expect(r.ledger().sources[0]?.contentHash).toBe(DOC_HASH);
    expect(r.facts().cards[0]?.sources[0]?.contentHash).toBe(STALE);
  });

  it("HTML でない本文_ハッシュは変わらず、変更なしと数える", async () => {
    const root = setup({ cached: false });
    const md = Buffer.from("# 見出し\n\n本文です。\n");
    const mdHash = rawSha256(md);
    mkdirSync(join(root, config.workDir, "cache"), { recursive: true });
    writeFileSync(join(root, config.workDir, "cache", `${mdHash}.body`), md);
    writeLedger(ledgerPath(resolve(root, config.ledgerDir), CODE), {
      ...emptyLedger(CODE),
      sources: [entry({ url: DOC_URL, contentHash: mdHash })],
    });
    const r = await run(root, ["rehash", CODE]);
    expect(r.out).toContain("変更なし 1 件");
    expect(r.ledger().sources[0]?.contentHash).toBe(mdHash);
  });

  it("--dry-run_何も書かず、通信もしない", async () => {
    const root = setup();
    const r = await run(root, ["rehash", CODE, "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("書き込みをしない(dry-run)");
    expect(r.ledger().sources[0]?.contentHash).toBe(OLD);
    expect(r.cacheHas(DOC_HASH)).toBe(false);
    expect(r.net.requests).toEqual([]);
  });

  it("試験ガイドの記録と続きのページ_ハッシュが新しい定義へ移る", async () => {
    const root = setup();
    const pageUrl = "https://docs.aws.amazon.com/guide/page-two.html";
    const pageHtml = "<html><head><meta name=a content=1></head><body><main>続きのページの本文</main></body></html>";
    const pageOld = rawSha256(Buffer.from(pageHtml));
    writeFileSync(join(root, config.workDir, "cache", `${pageOld}.body`), pageHtml);
    const ledgerFile = ledgerPath(resolve(root, config.ledgerDir), CODE);
    writeLedger(ledgerFile, {
      ...emptyLedger(CODE),
      sources: [entry({ url: DOC_URL, contentHash: OLD }), entry({ url: pageUrl, contentHash: pageOld })],
      guide: {
        sourceUrl: DOC_URL,
        contentHash: OLD,
        pages: [{ url: pageUrl, contentHash: pageOld }],
        importedAt: "2026-10-01",
        domains: [{ code: "domain1", name: "分野 1", weight: 1, scope: ["範囲 1"] }],
      },
    });
    const r = await run(root, ["rehash", CODE]);
    expect(r.code).toBe(EXIT.ok);
    const ledger = r.ledger();
    expect(ledger.guide?.contentHash).toBe(DOC_HASH);
    const pageNew = contentHashOf(Buffer.from(pageHtml));
    expect(pageNew).not.toBe(pageOld);
    expect(ledger.guide?.pages[0]?.contentHash).toBe(pageNew);
    expect(ledger.sources.find((x) => x.url === pageUrl)?.contentHash).toBe(pageNew);
  });

  it("同じ URL の旧い 2 つのハッシュが同じ新しいハッシュになる_内容が同じ判断は 1 つにまとめる", async () => {
    const root = setup();
    const variant = HTML.replace("</head>", "<meta name=extra content=2></head>");
    expect(variant).not.toBe(HTML);
    const variantOld = rawSha256(Buffer.from(variant));
    writeFileSync(join(root, config.workDir, "cache", `${variantOld}.body`), variant);
    const file = decisionsPath(resolve(root, config.decisionsDir), CODE);
    writeDecisions(file, {
      examCode: CODE,
      decisions: [
        { target: "source", url: DOC_URL, contentHash: OLD, decision: "accept", reason: "stale-but-correct" },
        { target: "source", url: DOC_URL, contentHash: variantOld, decision: "accept", reason: "stale-but-correct" },
      ],
    });
    const r = await run(root, ["rehash", CODE]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.decisions().decisions).toHaveLength(1);
    expect(r.decisions().decisions[0]).toMatchObject({ contentHash: DOC_HASH });
  });

  it("書き換えたあとの記録が検査を通らない_何も書かず、検査の失敗で終わる", async () => {
    const root = setup();
    const variant = HTML.replace("</head>", "<meta name=extra content=2></head>");
    const variantOld = rawSha256(Buffer.from(variant));
    writeFileSync(join(root, config.workDir, "cache", `${variantOld}.body`), variant);
    writeDecisions(decisionsPath(resolve(root, config.decisionsDir), CODE), {
      examCode: CODE,
      decisions: [
        { target: "source", url: DOC_URL, contentHash: OLD, decision: "accept", reason: "stale-but-correct" },
        { target: "source", url: DOC_URL, contentHash: variantOld, decision: "accept", reason: "other-reason" },
      ],
    });
    const r = await run(root, ["rehash", CODE]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("判断の記録の誤り");
    expect(r.ledger().sources[0]?.contentHash).toBe(OLD);
    expect(r.cacheHas(DOC_HASH)).toBe(false);
    expect(r.facts().extracted[0]?.contentHash).toBe(OLD);
  });

  it("--dry-run_壊れたキャッシュのファイルを消さない", async () => {
    const root = setup();
    const broken = join(root, config.workDir, "cache", `${rawSha256(Buffer.from("別の本文"))}.body`);
    writeFileSync(broken, "tampered");
    await run(root, ["rehash", CODE, "--dry-run"]);
    expect(existsSync(broken)).toBe(true);
  });

  it("資格コードがない_入力の誤り", async () => {
    const r = await run(setup(), ["rehash"]);
    expect(r.code).toBe(EXIT.inputError);
  });
});
