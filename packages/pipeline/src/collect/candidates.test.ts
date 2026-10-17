import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT } from "../exit-codes.ts";
import { main } from "../main.ts";
import { installAgentDefinitions } from "../shared/test-helpers.ts";
import { filterCandidates } from "./candidates.ts";
import { emptyLedger, ledgerPath, writeLedger } from "./ledger.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8"));
const CODE = "AWS-AIB-C01";
const GUIDE = "https://docs.aws.amazon.com/guide/index.html";
const IN_PLAN = "https://docs.aws.amazon.com/already/planned.html";
const GOOD = "https://docs.aws.amazon.com/service/quotas.html";

const plan = {
  examCode: CODE,
  sources: [
    { url: GUIDE, kind: "exam-guide" },
    { url: IN_PLAN, kind: "official-doc" },
  ],
  scope: { prefixes: ["https://docs.aws.amazon.com/"], maxDepth: 0 },
  exclude: [],
};

/** 試験ガイドを取り込み済みの台帳と、計画がある作業ディレクトリ */
function setupRoot(guide = true) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-candidates-"));
  mkdirSync(join(root, "data"));
  cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
  installAgentDefinitions(root);
  mkdirSync(join(root, config.plansDir), { recursive: true });
  writeFileSync(join(root, config.plansDir, "aws-aib-c01.json"), JSON.stringify(plan));
  writeLedger(ledgerPath(join(root, config.ledgerDir), CODE), {
    ...emptyLedger(CODE),
    guide: guide
      ? {
          sourceUrl: GUIDE,
          contentHash: "b".repeat(64),
          pages: [],
          importedAt: "2026-10-13",
          domains: [
            { code: "domain1", name: "分野 1", weight: 0.5, scope: ["項目 A の言い換え", "項目 B の言い換え"] },
            { code: "domain2", name: "分野 2", weight: 0.5, scope: ["項目 C の言い換え"] },
          ],
        }
      : null,
  });
  return root;
}

async function run(root: string, argv: string[], overrides: Record<string, unknown> = {}) {
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
  });
  return { code, out, err };
}

const dir = (root: string, ...parts: string[]) => join(root, config.workDir, "candidates", "aws-aib-c01", ...parts);

function request(root: string) {
  const file = readdirSync(dir(root, "requests"))[0] as string;
  return { file, body: JSON.parse(readFileSync(join(dir(root, "requests"), file), "utf8")) };
}

function writeOut(root: string, body: object) {
  const { body: req } = request(root);
  mkdirSync(dir(root, "out"), { recursive: true });
  writeFileSync(
    join(root, req.outputPath),
    JSON.stringify({ examCode: CODE, requestKey: req.requestKey, items: [], ...body }),
  );
}

const cand = (url: string) => ({ url, reason: "その項目の仕様をまとめた公式の文書" });

describe("候補の検査(filterCandidates)", () => {
  const ctx = { vendor: "AWS", planSources: [IN_PLAN] };

  it("許可ホストの https_残る。許可外のホスト・https でない・計画にある・重複は理由コードで落ちる", () => {
    const r = filterCandidates(
      [
        cand(GOOD),
        cand("https://evil.example.com/page.html"),
        cand("http://docs.aws.amazon.com/plain.html"),
        cand(IN_PLAN),
        cand(GOOD),
        cand("https://docs.aws.amazon.com/page.html?x=1"),
        cand("not a url"),
      ],
      ctx,
    );
    expect(r.kept.map((c) => c.url)).toEqual([GOOD]);
    expect(r.dropped).toEqual(["host-not-allowed", "not-https", "already-in-plan", "duplicate", "query", "not-https"]);
  });

  it("別のベンダーのホスト_このベンダーに許していないので落とす", () => {
    expect(filterCandidates([cand(GOOD)], { vendor: "Other", planSources: [] }).dropped).toEqual(["host-not-allowed"]);
  });
});

describe("collect --candidates", () => {
  it("依頼_試験ガイドの項目(添字つき)・計画の出典・許可ホスト・上限を載せ、取得した本文は載せない", async () => {
    const root = setupRoot();
    const r = await run(root, ["collect", CODE, "--candidates"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("候補の依頼: pipeline-work/candidates/aws-aib-c01/requests/");
    const { body, file } = request(root);
    expect(file).toBe(`${body.requestKey}.json`);
    expect(body.items).toEqual([
      { domain: "domain1", item: 0, text: "項目 A の言い換え" },
      { domain: "domain1", item: 1, text: "項目 B の言い換え" },
      { domain: "domain2", item: 0, text: "項目 C の言い換え" },
    ]);
    expect(body.planSources).toEqual([GUIDE, IN_PLAN].sort());
    expect(body.allowedHosts).toEqual(["aws.amazon.com", "docs.aws.amazon.com", "www.nist.gov"]);
    expect(body.maxPerItem).toBe(config.candidates.maxPerItem);
    expect(body.agent.role).toBe("source-scout");
    expect(Object.keys(body).sort()).toEqual([
      "agent",
      "allowedHosts",
      "examCode",
      "items",
      "maxPerItem",
      "outputPath",
      "planSources",
      "requestKey",
      "vendor",
    ]);
  });

  it("同じ入力で再実行_依頼を増やさず、待っていると報告する", async () => {
    const root = setupRoot();
    await run(root, ["collect", CODE, "--candidates"]);
    const again = await run(root, ["collect", CODE, "--candidates"]);
    expect(again.out).toContain("依頼済みで待っている 1 件");
    expect(readdirSync(dir(root, "requests"))).toHaveLength(1);
  });

  it("試験ガイドが台帳にない・計画がない_入力の誤りと計画の誤りで止まる", async () => {
    const noGuide = await run(setupRoot(false), ["collect", CODE, "--candidates"]);
    expect(noGuide.code).toBe(EXIT.inputError);
    expect(noGuide.err).toContain("試験ガイドが台帳にない");
    const root = setupRoot();
    rmSync(join(root, config.plansDir, "aws-aib-c01.json"));
    const noPlan = await run(root, ["collect", CODE, "--candidates"]);
    expect(noPlan.code).toBe(EXIT.checkFailed);
    expect(noPlan.err).toContain("計画の誤り");
  });

  it("dry-run_依頼を書かない", async () => {
    const root = setupRoot();
    const r = await run(root, ["collect", CODE, "--candidates", "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(existsSync(dir(root, "requests"))).toBe(false);
  });

  it("collect の動作のオプション_同時には 1 つだけ", async () => {
    const root = setupRoot();
    expect((await run(root, ["collect", CODE, "--candidates", "--import-guide"])).code).toBe(EXIT.inputError);
  });
});

describe("collect --import-candidates", () => {
  async function requested() {
    const root = setupRoot();
    await run(root, ["collect", CODE, "--candidates"]);
    return root;
  }

  it("候補_許可ドメインの https は一覧に残り、許可外・計画にある・https でないものは理由コードの件数だけを報告する。本文と URL は報告に出さない", async () => {
    const root = await requested();
    writeOut(root, {
      items: [
        {
          domain: "domain1",
          item: 0,
          candidates: [
            cand(GOOD),
            cand("https://evil.example.com/x.html"),
            cand(IN_PLAN),
            cand("http://docs.aws.amazon.com/a.html"),
          ],
        },
        { domain: "domain1", item: 1, candidates: [] },
      ],
    });
    const r = await run(root, ["collect", CODE, "--import-candidates"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("候補: domain1 項目 0 候補 1 件");
    expect(r.out).toContain("候補: domain1 項目 1 候補 0 件");
    expect(r.out).toContain("候補のない項目: domain1 項目 1");
    expect(r.out).toContain("候補のない項目: domain2 項目 0");
    expect(r.out).toContain("候補の不採用: host-not-allowed 1 件");
    expect(r.out).toContain("候補の不採用: already-in-plan 1 件");
    expect(r.out).toContain("候補の不採用: not-https 1 件");
    for (const secret of ["evil.example.com", IN_PLAN, GOOD, "項目 A", "言い換え"]) {
      expect(r.out + r.err).not.toContain(secret);
    }
    // 結果は作業用の置き場にだけ書く。計画には自動で入れない
    const result = JSON.parse(readFileSync(dir(root, "candidates.json"), "utf8"));
    expect(
      result.items.find((i: { domain: string; item: number }) => i.domain === "domain1" && i.item === 0).candidates,
    ).toEqual([cand(GOOD)]);
    expect(JSON.parse(readFileSync(join(root, config.plansDir, "aws-aib-c01.json"), "utf8"))).toEqual(plan);
    expect(readdirSync(dir(root, "requests"))).toEqual([]);
  });

  it("取り込み済みの入力_同じ入力では依頼しない", async () => {
    const root = await requested();
    writeOut(root, { items: [{ domain: "domain1", item: 0, candidates: [cand(GOOD)] }] });
    await run(root, ["collect", CODE, "--import-candidates"]);
    const again = await run(root, ["collect", CODE, "--candidates"]);
    expect(again.out).toContain("取り込み済み");
    expect(existsSync(dir(root, "requests")) ? readdirSync(dir(root, "requests")) : []).toEqual([]);
  });

  it("形が違う出力・依頼にない項目・同じ項目の重複・上限の超過_取り込まず、理由コードで止まる", async () => {
    const root = await requested();
    const bad: object[] = [
      { items: "壊れている" },
      { items: [{ domain: "domain9", item: 0, candidates: [] }] },
      { items: [{ domain: "domain1", item: 5, candidates: [] }] },
      {
        items: [
          { domain: "domain1", item: 0, candidates: [] },
          { domain: "domain1", item: 0, candidates: [] },
        ],
      },
      {
        items: [
          {
            domain: "domain1",
            item: 0,
            candidates: Array.from({ length: config.candidates.maxPerItem + 1 }, (_, i) =>
              cand(`https://docs.aws.amazon.com/p${i}.html`),
            ),
          },
        ],
      },
    ];
    for (const body of bad) {
      writeOut(root, body);
      const r = await run(root, ["collect", CODE, "--import-candidates"]);
      expect(r.code).toBe(EXIT.checkFailed);
      expect(r.err).toContain("output-invalid");
      expect(existsSync(dir(root, "candidates.json"))).toBe(false);
    }
  });

  it("上限の数ちょうどの候補_取り込める", async () => {
    const root = await requested();
    const urls = Array.from({ length: config.candidates.maxPerItem }, (_, i) =>
      cand(`https://docs.aws.amazon.com/p${i}.html`),
    );
    writeOut(root, { items: [{ domain: "domain1", item: 0, candidates: urls }] });
    const r = await run(root, ["collect", CODE, "--import-candidates"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain(`候補: domain1 項目 0 候補 ${config.candidates.maxPerItem} 件`);
  });

  it("依頼と違う鍵_request-mismatch で止まる", async () => {
    const root = await requested();
    writeOut(root, { requestKey: "0".repeat(16) });
    const r = await run(root, ["collect", CODE, "--import-candidates"]);
    expect(r.err).toContain("request-mismatch");
  });

  it("依頼のあとに計画が変わった_request-stale で捨てる。定義が変わったときも同じ", async () => {
    const root = await requested();
    writeOut(root, { items: [{ domain: "domain1", item: 0, candidates: [cand(GOOD)] }] });
    writeFileSync(
      join(root, config.plansDir, "aws-aib-c01.json"),
      JSON.stringify({ ...plan, sources: [...plan.sources, { url: GOOD, kind: "official-doc" }] }),
    );
    const r = await run(root, ["collect", CODE, "--import-candidates"]);
    expect(r.err).toContain("request-stale");
    expect(existsSync(dir(root, "candidates.json"))).toBe(false);
    // 定義
    const root2 = await requested();
    writeOut(root2, { items: [] });
    const path = join(root2, ".claude", "agents", "source-scout.md");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n- 追加した指示\n`);
    expect((await run(root2, ["collect", CODE, "--import-candidates"])).err).toContain("request-stale");
  });

  it("出力がまだない依頼_待っていると報告するだけ", async () => {
    const root = await requested();
    const r = await run(root, ["collect", CODE, "--import-candidates"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.err).toContain("候補の出力なし");
  });
});
