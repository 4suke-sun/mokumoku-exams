import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { BodyCache } from "../collect/cache.ts";
import { Fetcher, sha256 } from "../collect/fetcher.ts";
import { emptyLedger, type LedgerFile, ledgerPath, readLedger, writeLedger } from "../collect/ledger.ts";
import { entry, fakeNet, testFetchConfig } from "../collect/test-helpers.ts";
import { decisionsPath, writeDecisions } from "../decisions/decisions.ts";
import { EXIT } from "../exit-codes.ts";
import { main } from "../main.ts";
import { readAgentStamp } from "../shared/agents.ts";
import { installAgentDefinitions, repoDefinitionHash } from "../shared/test-helpers.ts";
import { requestKey } from "./extract.ts";
import { COPY_PLACEHOLDER } from "./overlap.ts";
import { type FactsFile, factsPath, readFacts } from "./schema.ts";
import { DOC_HASH, DOC_URL, factsFixture } from "./test-helpers.ts";

const CODE = "AWS-AIB-C01";
const repoRoot = resolve(import.meta.dirname, "../../../..");
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8"));
const FACT_AGENT = readAgentStamp(repoRoot, "fact-extractor");
const KEY = requestKey(DOC_URL, DOC_HASH, repoDefinitionHash("fact-extractor"));

const guide = {
  sourceUrl: "https://docs.aws.amazon.com/guide/index.html",
  contentHash: "b".repeat(64),
  pages: [],
  importedAt: "2026-10-13",
  domains: [
    { code: "domain1", name: "分野 1", weight: 0.24, scope: ["項目 A", "項目 B", "項目 C"] },
    { code: "domain2", name: "分野 2", weight: 0.28, scope: ["項目 D"] },
  ],
};

function setupRoot(ledgerOverrides: Partial<LedgerFile> = {}) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-facts-"));
  mkdirSync(join(root, "data"));
  cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
  installAgentDefinitions(root);
  const ledger: LedgerFile = {
    ...emptyLedger(CODE),
    guide,
    sources: [entry({ url: DOC_URL, contentHash: DOC_HASH })],
    ...ledgerOverrides,
  };
  writeLedger(ledgerPath(join(root, config.ledgerDir), CODE), ledger);
  cacheBody(root, factsFixture("service-doc.html"));
  return root;
}

function cacheBody(root: string, body: string) {
  new BodyCache(join(root, config.workDir, "cache"), config.cache).write(Buffer.from(body));
}

async function run(root: string, argv: string[], overrides: Record<string, unknown> = {}, today = "2026-10-13") {
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
    collectDeps: {
      fetcher: new Fetcher(testFetchConfig, fakeNet({}).deps),
      today: () => today,
      now: () => Date.parse(today),
    },
  });
  return {
    code,
    out,
    err,
    facts: (): FactsFile => readFacts(factsPath(join(root, config.factsDir), CODE), CODE),
    ledger: () => readLedger(ledgerPath(join(root, config.ledgerDir), CODE), CODE),
  };
}

const workDir = (root: string) => join(root, config.workDir, "facts", "aws-aib-c01");
const outFile = (root: string, key = KEY) => join(workDir(root), "out", `${key}.json`);

function writeOut(root: string, cards: unknown[], extra: Record<string, unknown> = {}, key = KEY) {
  mkdirSync(join(workDir(root), "out"), { recursive: true });
  writeFileSync(
    outFile(root, key),
    JSON.stringify({ examCode: CODE, sourceUrl: DOC_URL, contentHash: DOC_HASH, cards, ...extra }),
  );
}

const good = {
  claim: "Widget Store では、1 つのアカウントがリージョンごとに持てるバケットは 100 個まで。",
  section: "Quotas and limits",
  anchor: { heading: "quotas", quote: "up to 100 buckets per account" },
  confidence: "high",
  domain: "domain1",
  scopeItems: [0],
};
const rate = {
  claim: "Widget Store は、プレフィックスごとに毎秒 3,500 件の書き込みを受け付ける。",
  section: "Request rates",
  anchor: { heading: "quotas-rate", quote: "write requests per second" },
  confidence: "medium",
  domain: "domain1",
  scopeItems: [2],
};

describe("facts: 抽出の依頼", () => {
  it("台帳の active な出典ごとに、本文の場所と分野を書いた依頼を作業用の置き場に書く。本文は書かない", async () => {
    const root = setupRoot();
    const r = await run(root, ["facts", CODE]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain(`事実カードの依頼: pipeline-work/facts/aws-aib-c01/requests/${KEY}.json`);
    const text = readFileSync(join(workDir(root), "requests", `${KEY}.json`), "utf8");
    const request = JSON.parse(text);
    expect(request.bodyPath).toBe(`pipeline-work/cache/${DOC_HASH}.body`);
    expect(request.outputPath).toBe(`pipeline-work/facts/aws-aib-c01/out/${KEY}.json`);
    expect(request.target).toEqual({ edition: "C01" });
    expect(request.domains.find((d: { code: string }) => d.code === "domain1").scope).toEqual([
      "項目 A",
      "項目 B",
      "項目 C",
    ]);
    expect(text).not.toContain("Synthetic");
  });

  it("active でない出典・本文がキャッシュにない出典_依頼しない", async () => {
    const root = setupRoot({
      sources: [
        entry({ url: DOC_URL, contentHash: DOC_HASH, status: "needs-review" }),
        entry({ url: "https://docs.aws.amazon.com/guide/uncached.html", contentHash: "c".repeat(64) }),
      ],
    });
    const r = await run(root, ["facts", CODE]);
    expect(r.out).toContain("依頼 0 件");
    expect(r.err).toContain("事実カードの本文なし: https://docs.aws.amazon.com/guide/uncached.html");
    expect(existsSync(join(workDir(root), "requests"))).toBe(false);
    // 本文がない出典は、依頼を書けなかった失敗として数える
    expect(r.code).toBe(EXIT.checkFailed);
  });

  it("試験ガイドのページとサービスの文書が混ざる台帳_サービスの文書にだけ依頼する", async () => {
    const root = setupRoot({
      sources: [
        entry({ url: DOC_URL, contentHash: DOC_HASH }),
        entry({ url: "https://docs.aws.amazon.com/guide/index.html", kind: "exam-guide", contentHash: DOC_HASH }),
        entry({ url: "https://docs.aws.amazon.com/guide/domain1.html", kind: "exam-guide", contentHash: DOC_HASH }),
      ],
    });
    const r = await run(root, ["facts", CODE]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("依頼 1 件");
    expect(readdirSync(join(workDir(root), "requests"))).toEqual([`${KEY}.json`]);
  });

  it("本文がない出典と依頼できる出典が混ざる_依頼できる出典の依頼は書き_終了コード 1 で終わる", async () => {
    const root = setupRoot({
      sources: [
        entry({ url: DOC_URL, contentHash: DOC_HASH }),
        entry({ url: "https://docs.aws.amazon.com/guide/uncached.html", contentHash: "c".repeat(64) }),
      ],
    });
    const r = await run(root, ["facts", CODE]);
    expect(r.out).toContain("依頼 1 件");
    expect(r.err).toContain("事実カードの本文なし: https://docs.aws.amazon.com/guide/uncached.html");
    expect(r.code).toBe(EXIT.checkFailed);
  });

  it("dry-run_依頼の数を報告するだけで、書き込まない", async () => {
    const root = setupRoot();
    const r = await run(root, ["facts", CODE, "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("依頼 1 件");
    expect(existsSync(join(workDir(root), "requests"))).toBe(false);
  });

  it("件数の上限_続きから進めるように、上限で止める", async () => {
    const other = "https://docs.aws.amazon.com/guide/second.html";
    const root = setupRoot({
      sources: [entry({ url: DOC_URL, contentHash: DOC_HASH }), entry({ url: other, contentHash: DOC_HASH })],
    });
    const r = await run(root, ["facts", CODE], { maxItemsPerRun: 1 });
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("件数の上限");
    expect(readdirSync(join(workDir(root), "requests"))).toHaveLength(1);
  });

  it("資格マスタにない資格・形の違う資格コード_入力の誤り", async () => {
    const root = setupRoot();
    expect((await run(root, ["facts", "AWS-ZZZ-C01"])).code).toBe(EXIT.inputError);
    expect((await run(root, ["facts", "secret-looking-code"])).code).toBe(EXIT.inputError);
    expect((await run(root, ["facts"])).code).toBe(EXIT.inputError);
  });
});

describe("facts --import", () => {
  it("抽出の結果を検査して取り込む_通過・不採用・重複・保留を理由コードつきで記録する", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [
      good,
      // 同じ主張(表記ゆれ)は 1 件にまとまる
      {
        ...good,
        claim: good.claim.replace("Widget Store", "WIDGET  STORE"),
        anchor: { ...good.anchor, heading: "Quotas and limits" },
      },
      rate,
      { ...good, claim: "Widget Store では、バケットは 200 個まで。" },
      { ...good, claim: "Gadget Store では、バケットは 100 個まで。" },
      { ...good, anchor: { heading: "no-such-heading", quote: "x" } },
      {
        ...good,
        claim: "Encryption at rest is enabled by default for every new bucket in Widget Store",
        anchor: { heading: "security", quote: "enabled by default" },
      },
      { ...good, domain: "domain9" },
    ]);
    const r = await run(root, ["facts", CODE, "--import"]);
    expect(r.code).toBe(EXIT.ok);
    const cards = r.facts().cards;
    const reasonsOf = (pick: (c: (typeof cards)[number]) => boolean) => cards.find(pick)?.reasons;
    expect(cards.filter((c) => c.status === "passed")).toHaveLength(2);
    expect(reasonsOf((c) => c.claim.includes("200 個"))).toEqual(["number-mismatch"]);
    expect(reasonsOf((c) => c.claim.startsWith("Gadget"))).toEqual(["term-not-found"]);
    expect(reasonsOf((c) => c.sources[0]?.anchor.heading === "no-such-heading")).toEqual(["anchor-not-found"]);
    expect(reasonsOf((c) => c.reasons.includes("long-copy"))).toEqual(["long-copy"]);
    // 本文の写しは、不採用でも台帳に残さない
    expect(cards.find((c) => c.reasons.includes("long-copy"))?.claim).toBe(COPY_PLACEHOLDER);
    expect(reasonsOf((c) => c.domain === "domain9")).toEqual(["unknown-domain"]);
    // 重複はまとまり、根拠の出典は残る。ハッシュは CLI が入れる
    const merged = cards.find((c) => c.claim.startsWith("Widget Store では、1 つ"));
    expect(merged?.sources[0]?.contentHash).toBe(DOC_HASH);
    expect(r.out).toContain("重複をまとめた 1 件");
    expect(r.out).toContain("事実カードの不採用: number-mismatch 1 件");
    expect(r.out).toContain("事実カードの不採用: long-copy 1 件");
    // 取り込んだ依頼と結果は片づく。コミットする台帳に本文は入らない
    expect(readdirSync(join(workDir(root), "requests"))).toHaveLength(0);
    const committed = readFileSync(factsPath(join(root, config.factsDir), CODE), "utf8");
    expect(committed).not.toContain("Synthetic");
    expect(committed).not.toContain("Encryption at rest is enabled");
    expect(r.facts().extracted).toEqual([{ url: DOC_URL, contentHash: DOC_HASH, agent: FACT_AGENT }]);
  });

  it("同じ入力で再実行_抽出済みなので、依頼を出さない(モデルを呼ばない)", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [good]);
    await run(root, ["facts", CODE, "--import"]);
    const again = await run(root, ["facts", CODE]);
    expect(again.out).toContain("依頼 0 件、抽出済みで飛ばした 1 件");
    expect(existsSync(join(workDir(root), "requests", `${KEY}.json`))).toBe(false);
  });

  it("同じ適用範囲で数値が食い違う_どちらも保留にして先へ進めない。適用範囲が違えば両方を残す", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    const conflicting = {
      ...good,
      claim:
        "Widget Store では、1 つのアカウントがリージョンごとに持てるバケットは 100 個まで。ただし 5 TB の制限がある。",
    };
    writeOut(root, [
      good,
      // 数値の組が違い、主張が似ている
      {
        ...conflicting,
        claim: good.claim.replace("100", "5"),
        anchor: { heading: "quotas", quote: "as large as 5 TB" },
      },
    ]);
    const r = await run(root, ["facts", CODE, "--import"]);
    const held = r.facts().cards.filter((c) => c.status === "held");
    expect(held).toHaveLength(2);
    expect(held.every((c) => c.reasons.join() === "conflict")).toBe(true);
    expect(r.out).toContain("事実カードの保留: conflict");
    const root2 = setupRoot();
    await run(root2, ["facts", CODE]);
    writeOut(root2, [
      good,
      {
        ...good,
        claim: good.claim.replace("100", "5"),
        anchor: { heading: "quotas", quote: "as large as 5 TB" },
        scope: { edition: "C02" },
      },
    ]);
    const r2 = await run(root2, ["facts", CODE, "--import"]);
    expect(r2.facts().cards.map((c) => c.status)).toEqual(["passed", "passed"]);
  });

  it("矛盾で保留のカードに人が保留の解除を記録した_次の取り込みで保留に戻らず、却下は再抽出しても不採用のまま", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    const other = {
      ...good,
      claim: good.claim.replace("100", "5"),
      anchor: { heading: "quotas", quote: "as large as 5 TB" },
    };
    writeOut(root, [good, other]);
    const first = await run(root, ["facts", CODE, "--import"]);
    const [a, b] = first.facts().cards.map((c) => c.id) as [string, string];
    const path = decisionsPath(join(root, config.decisionsDir), CODE);
    writeDecisions(path, {
      examCode: CODE,
      decisions: [
        { target: "fact", id: a, decision: "release", reason: "not-a-conflict" },
        { target: "fact", id: b, decision: "reject", reason: "wrong-number" },
      ],
    });
    // 依頼がなくても、取り込みは判断を反映する
    const second = await run(root, ["facts", CODE, "--import"]);
    expect(second.out).toContain("判断の反映");
    const status = (r: typeof second) => Object.fromEntries(r.facts().cards.map((c) => [c.id, c.status]));
    expect(status(second)).toEqual({ [a]: "passed", [b]: "rejected" });
    expect(second.facts().cards.find((c) => c.id === b)?.reasons).toEqual(["human-rejected"]);
    // 同じ出典を抽出し直しても(同じ内容なら同じ ID)、判断が引き継がれる
    const facts = readFacts(factsPath(join(root, config.factsDir), CODE), CODE);
    writeFileSync(factsPath(join(root, config.factsDir), CODE), JSON.stringify({ ...facts, extracted: [] }));
    await run(root, ["facts", CODE]);
    writeOut(root, [good, other]);
    const third = await run(root, ["facts", CODE, "--import"]);
    expect(status(third)).toEqual({ [a]: "passed", [b]: "rejected" });
  });

  it("対象のカードがない判断_黙って捨てずに報告する", async () => {
    const root = setupRoot();
    writeDecisions(decisionsPath(join(root, config.decisionsDir), CODE), {
      examCode: CODE,
      decisions: [{ target: "fact", id: "f-aaaaaaaaaaaa", decision: "release", reason: "ok" }],
    });
    const r = await run(root, ["facts", CODE, "--import"]);
    expect(r.err + r.out).toContain("判断の対象なし: fact f-aaaaaaaaaaaa");
  });

  it("出力の形が違う・依頼と合わない_取り込みを止め、理由コードを出す。上限まで試すと再試行をやめる", async () => {
    const root = setupRoot();
    const opts = { facts: { ...config.facts, maxAttempts: 2 } };
    await run(root, ["facts", CODE], opts);
    mkdirSync(join(workDir(root), "out"), { recursive: true });
    writeFileSync(outFile(root), "{ broken json");
    const first = await run(root, ["facts", CODE, "--import"], opts);
    expect(first.code).toBe(EXIT.checkFailed);
    expect(first.err).toContain(`事実カードの取り込みの停止: ${KEY} extract-invalid`);
    expect(existsSync(outFile(root))).toBe(false);

    await run(root, ["facts", CODE], opts);
    writeOut(root, [good], { contentHash: "e".repeat(64) });
    const second = await run(root, ["facts", CODE, "--import"], opts);
    expect(second.err).toContain(`${KEY} request-mismatch`);

    // 2 回失敗したので、もう依頼しない
    const third = await run(root, ["facts", CODE], opts);
    expect(third.code).toBe(EXIT.checkFailed);
    expect(third.err).toContain(`再試行の上限: ${DOC_URL}`);
    expect(third.out).toContain("依頼 0 件");
  });

  it("出力がまだない_待っていると報告するだけ", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    const r = await run(root, ["facts", CODE, "--import"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.err).toContain(`事実カードの出力なし: ${KEY}`);
  });

  it("依頼のあとに収集が進んで本文が変わった_古い依頼の結果は取り込まない", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [good]);
    const ledgerFile = ledgerPath(join(root, config.ledgerDir), CODE);
    writeLedger(ledgerFile, {
      ...readLedger(ledgerFile, CODE),
      sources: [entry({ url: DOC_URL, contentHash: "d".repeat(64) })],
    });
    const r = await run(root, ["facts", CODE, "--import"]);
    expect(r.err).toContain(`${KEY} request-stale`);
    expect(existsSync(factsPath(join(root, config.factsDir), CODE))).toBe(false);
  });

  it("出典の本文が変わって再抽出した_古いカードを置き換え、再検証の印を外す", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [good, rate]);
    const first = await run(root, ["facts", CODE, "--import"]);
    const [keep, drop] = [first.facts().cards[0], first.facts().cards[1]];
    expect(keep && drop).toBeTruthy();
    // 本文が変わった(上限が 100 から 150 になった)
    const body = factsFixture("service-doc.html").replace("100 buckets", "150 buckets");
    const hash = sha256(Buffer.from(body));
    cacheBody(root, body);
    const ledgerFile = ledgerPath(join(root, config.ledgerDir), CODE);
    const marked = readLedger(ledgerFile, CODE);
    writeLedger(ledgerFile, {
      ...marked,
      sources: [entry({ url: DOC_URL, contentHash: hash })],
      recheck: { facts: [keep?.id ?? "", drop?.id ?? ""], questions: [] },
    });
    await run(root, ["facts", CODE], {}, "2026-10-14");
    const key = requestKey(DOC_URL, hash, repoDefinitionHash("fact-extractor"));
    writeOut(
      root,
      [
        {
          ...good,
          claim: good.claim.replace("100", "150"),
          anchor: { heading: "quotas", quote: "up to 150 buckets per account" },
        },
      ],
      { contentHash: hash },
      key,
    );
    const r = await run(root, ["facts", CODE, "--import"], {}, "2026-10-14");
    expect(r.code).toBe(EXIT.ok);
    const file = r.facts();
    expect(file.cards).toHaveLength(1);
    expect(file.cards[0]?.claim).toContain("150");
    expect(file.cards[0]?.sources[0]?.contentHash).toBe(hash);
    expect(file.extracted).toEqual([{ url: DOC_URL, contentHash: hash, agent: FACT_AGENT }]);
    expect(r.ledger().recheck.facts).toEqual([]);
  });

  it("dry-run_検査と報告だけで、台帳も依頼も変えない", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [good]);
    const r = await run(root, ["facts", CODE, "--import", "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("取り込み: 抽出 1 件");
    expect(existsSync(factsPath(join(root, config.factsDir), CODE))).toBe(false);
    expect(existsSync(outFile(root))).toBe(true);
  });
});

describe("facts --coverage", () => {
  async function imported() {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [good, rate, { ...good, claim: "Widget Store では、バケットは 200 個まで。" }]);
    await run(root, ["facts", CODE, "--import"]);
    return root;
  }

  it("分野ごとの件数と、試験ガイドの範囲に対する抜けを報告する。本文を含まない", async () => {
    const root = await imported();
    const r = await run(root, ["facts", CODE, "--coverage"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("カバレッジ: domain1 通過 2 件、保留 0 件、不採用 1 件");
    expect(r.out).toContain("カバレッジ: domain2 通過 0 件");
    expect(r.out).toContain("カバレッジの抜け: domain1 項目 1");
    expect(r.out).toContain("カバレッジの抜け: domain2 項目 0");
    expect(r.out).not.toContain("カバレッジの抜け: domain1 項目 0");
    expect(r.out + r.err).not.toContain("項目 A");
    expect(r.out + r.err).not.toContain("bucket");
  });

  it("資格マスタにない分野の通過カード_検査が失敗する。data/ は変えない", async () => {
    const root = await imported();
    const path = factsPath(join(root, config.factsDir), CODE);
    const file = JSON.parse(readFileSync(path, "utf8")) as FactsFile;
    const first = file.cards.find((c) => c.status === "passed");
    if (first) first.domain = "domain9";
    writeFileSync(path, JSON.stringify(file));
    const masterBefore = readFileSync(join(root, "data/exams.json"), "utf8");
    const r = await run(root, ["facts", CODE, "--coverage"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toMatch(/事実カードの誤り: cards\.\d+\.domain/);
    expect(readFileSync(join(root, "data/exams.json"), "utf8")).toBe(masterBefore);
  });
});

describe("facts --report", () => {
  it("レビューレポートを作業用の置き場に書く_同じ入力と同じ種で、同じ内容。本文を含まない", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [good, rate, { ...good, claim: "Widget Store では、バケットは 200 個まで。" }]);
    await run(root, ["facts", CODE, "--import"]);
    const first = await run(root, ["facts", CODE, "--report"]);
    expect(first.code).toBe(EXIT.ok);
    expect(first.out).toContain("レビューレポート: pipeline-work/facts/aws-aib-c01/review.md");
    const md = readFileSync(join(workDir(root), "review.md"), "utf8");
    const json = readFileSync(join(workDir(root), "review.json"), "utf8");
    expect(md).toContain("通過 2、保留 0、不採用 1");
    expect(md).toContain("number-mismatch");
    for (const text of [md, json]) {
      expect(text).not.toContain("up to 100 buckets");
      expect(text).not.toContain("バケット");
    }
    await run(root, ["facts", CODE, "--report"]);
    expect(readFileSync(join(workDir(root), "review.md"), "utf8")).toBe(md);
  });

  it("通過・保留のカードの表_通過・保留のカードの主張と出典の URL が載り、不採用のカードと出典の本文は載らない", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [good, rate, { ...good, claim: "Widget Store では、バケットは 200 個まで。" }]);
    await run(root, ["facts", CODE, "--import"]);
    const r = await run(root, ["facts", CODE, "--report"]);
    expect(r.out).toContain("レビューレポート: pipeline-work/facts/aws-aib-c01/cards.md");
    const md = readFileSync(join(workDir(root), "cards.md"), "utf8");
    expect(md).toContain("通過と保留のカード 2 件");
    expect(md).toContain(good.claim);
    expect(md).toContain(DOC_URL);
    expect(md).not.toContain("200 個まで");
    expect(md).not.toContain("up to 100 buckets");
  });

  it("dry-run_書き込まない", async () => {
    const root = setupRoot();
    const r = await run(root, ["facts", CODE, "--report", "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(existsSync(join(workDir(root), "review.md"))).toBe(false);
  });
});

/** 作業ディレクトリの定義の指示に 1 行足す(指示が変わった状態にする) */
function changeDefinition(root: string, role: "fact-extractor" | "guide-extractor" | "question-drafter") {
  const path = join(root, ".claude", "agents", `${role}.md`);
  writeFileSync(path, `${readFileSync(path, "utf8")}\n- 追加した指示\n`);
}

describe("facts: エージェントの定義の記録", () => {
  it("依頼を書く_役の名前・モデルの ID・定義のハッシュを依頼に書き、指示の本文は書かない", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    const text = readFileSync(join(workDir(root), "requests", `${KEY}.json`), "utf8");
    expect(JSON.parse(text).agent).toEqual(FACT_AGENT);
    expect(FACT_AGENT.model).toMatch(/^claude-/);
    expect(text).not.toContain("作成役");
  });

  it("定義の指示を変えた_依頼の鍵が変わり、取り込み済みの出典も出し直す", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [good]);
    await run(root, ["facts", CODE, "--import"]);
    expect((await run(root, ["facts", CODE])).out).toContain("依頼 0 件、抽出済みで飛ばした 1 件");
    changeDefinition(root, "fact-extractor");
    const again = await run(root, ["facts", CODE]);
    expect(again.out).toContain("依頼 1 件");
    expect(again.out).not.toContain(KEY);
  });

  it("定義の説明だけを変えた_鍵は変わらず、出し直さない", async () => {
    const root = setupRoot();
    const path = join(root, ".claude", "agents", "fact-extractor.md");
    await run(root, ["facts", CODE]);
    writeOut(root, [good]);
    await run(root, ["facts", CODE, "--import"]);
    writeFileSync(path, readFileSync(path, "utf8").replace(/^description: .*$/m, "description: 言い回しを直した説明"));
    expect((await run(root, ["facts", CODE])).out).toContain("依頼 0 件、抽出済みで飛ばした 1 件");
  });

  it("依頼のあとに定義が変わった_取り込まず、依頼を作り直す(失敗の回数には数えない)", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [good]);
    changeDefinition(root, "fact-extractor");
    const r = await run(root, ["facts", CODE, "--import"]);
    expect(r.err).toContain(`事実カードの取り込みの停止: ${KEY} request-stale`);
    expect(r.facts().cards).toEqual([]);
    expect(existsSync(outFile(root))).toBe(false);
    expect(existsSync(join(workDir(root), "requests", `${KEY}.json`))).toBe(false);
  });

  it("定義が変わったあとの出力が形に合わない_失敗に数えず、request-stale で依頼を捨てる", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    mkdirSync(join(workDir(root), "out"), { recursive: true });
    writeFileSync(outFile(root), "壊れた出力");
    changeDefinition(root, "fact-extractor");
    const r = await run(root, ["facts", CODE, "--import"]);
    expect(r.err).toContain(`${KEY} request-stale`);
    expect(r.err).not.toContain("extract-invalid");
  });

  it("依頼のファイルが JSON の null_request-invalid で止め、取り込まない", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [good]);
    writeFileSync(join(workDir(root), "requests", `${KEY}.json`), "null");
    const r = await run(root, ["facts", CODE, "--import"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain(`${KEY} request-invalid`);
  });

  it("取り込んだ結果_どの定義・モデルで作ったかがたどれ、指示の本文は持たない", async () => {
    const root = setupRoot();
    await run(root, ["facts", CODE]);
    writeOut(root, [good]);
    const r = await run(root, ["facts", CODE, "--import"]);
    expect(r.facts().extracted[0]?.agent).toEqual(FACT_AGENT);
    expect(readFileSync(factsPath(join(root, config.factsDir), CODE), "utf8")).not.toContain("作成役");
  });

  it("定義のファイルがない_役の名前だけを報告して止まる", async () => {
    const root = setupRoot();
    rmSync(join(root, ".claude", "agents", "fact-extractor.md"));
    const r = await run(root, ["facts", CODE]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("エージェントの定義の誤り: fact-extractor");
  });
});
