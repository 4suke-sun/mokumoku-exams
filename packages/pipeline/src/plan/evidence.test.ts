import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyLedger, ledgerPath, writeLedger } from "../collect/ledger.ts";
import { entry } from "../collect/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { emptyFacts, factsPath, writeFacts } from "../facts/schema.ts";
import { card, DOC_HASH, DOC_URL } from "../facts/test-helpers.ts";
import { main } from "../main.ts";
import { readAgentStamp } from "../shared/agents.ts";
import { installAgentDefinitions, withoutExamSettings } from "../shared/test-helpers.ts";
import { evidenceCounts, MIN_EVIDENCE_CARDS } from "./evidence.ts";
import type { PlanItem } from "./schema.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const CODE = "AWS-AIB-C01";

const ledger = { ...emptyLedger(CODE), sources: [entry({ url: DOC_URL, contentHash: DOC_HASH })] };
const cardOf = (n: number, over: Parameters<typeof card>[0] = {}) =>
  card({ id: `f-${String(n).padStart(12, "0")}`, ...over });
const item = (id: string, over: Partial<PlanItem> = {}): PlanItem => ({
  id,
  domain: "domain1",
  difficulty: "medium",
  kind: "single",
  count: 3,
  ...over,
});

describe("evidenceCounts", () => {
  it("分野の項目_その分野の根拠にできるカードだけを数え_目安に届かないものを不足にする", () => {
    const facts = {
      ...emptyFacts(CODE),
      cards: [1, 2, 3, 4].map((n) => cardOf(n)).concat([cardOf(5, { domain: "domain2" })]),
    };
    const [d1, d2] = evidenceCounts(
      [item("p-000000000001"), item("p-000000000002", { domain: "domain2" })],
      facts,
      ledger,
    );
    expect(d1).toMatchObject({ itemId: "p-000000000001", scope: "domain1", cards: 4, short: false });
    expect(d2).toMatchObject({ scope: "domain2", cards: 1, short: true });
    expect(MIN_EVIDENCE_CARDS).toBe(4);
  });

  it("通過でないカードと再検証の印のあるカード_根拠にできるとして数えない", () => {
    const facts = {
      ...emptyFacts(CODE),
      cards: [cardOf(1), cardOf(2, { status: "held" }), cardOf(3), cardOf(4), cardOf(5)],
    };
    const marked = { ...ledger, recheck: { ...ledger.recheck, facts: ["f-000000000003"] } };
    const [count] = evidenceCounts([item("p-000000000001")], facts, marked);
    expect(count?.cards).toBe(3);
  });

  it("根拠の出典が台帳にない_根拠にできるとして数えない", () => {
    const facts = { ...emptyFacts(CODE), cards: [1, 2, 3, 4].map((n) => cardOf(n)) };
    const [count] = evidenceCounts([item("p-000000000001")], facts, emptyLedger(CODE));
    expect(count?.cards).toBe(0);
  });

  it("論点の枠の項目_枠の出典の範囲のカードを、分野を問わず数える", () => {
    const facts = {
      ...emptyFacts(CODE),
      cards: [cardOf(1), cardOf(2, { domain: "domain2" }), cardOf(3, { domain: "domain3" })],
    };
    const focus = {
      id: "maturity",
      sourcePrefixes: ["https://docs.aws.amazon.com/guide/"],
      instruction: "段階を選ばせる",
    };
    const other = { id: "other", sourcePrefixes: ["https://example.com/"], instruction: "別の範囲" };
    const [inRange, outOfRange] = evidenceCounts(
      [item("p-000000000001", { focus }), item("p-000000000002", { focus: other })],
      facts,
      ledger,
    );
    expect(inRange).toMatchObject({ scope: "focus:maturity", cards: 3 });
    expect(outOfRange).toMatchObject({ scope: "focus:other", cards: 0, short: true });
  });
});

describe("plan コマンドの根拠の事実カードの報告", () => {
  const config = withoutExamSettings(
    JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8")),
    CODE,
  );

  async function runPlan(cards: number) {
    const root = mkdtempSync(join(tmpdir(), "pipeline-evidence-"));
    mkdirSync(join(root, "data"));
    cpSync(join(repoRoot, "data/exams.json"), join(root, "data/exams.json"));
    installAgentDefinitions(root);
    writeLedger(ledgerPath(join(root, config.ledgerDir), CODE), ledger);
    writeFacts(factsPath(join(root, config.factsDir), CODE), {
      ...emptyFacts(CODE),
      extracted: [{ url: DOC_URL, contentHash: DOC_HASH, agent: readAgentStamp(root, "fact-extractor") }],
      cards: Array.from({ length: cards }, (_, i) => cardOf(i + 1)),
    });
    const configPath = join(root, "pipeline.config.json");
    writeFileSync(configPath, JSON.stringify(config));
    let out = "";
    let err = "";
    const code = await main({
      argv: ["plan", CODE],
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

  it("根拠にできるカードが目安に届かない項目_不足と報告し、計画は止めない", async () => {
    const r = await runPlan(3);
    expect(r.code).toBe(EXIT.ok);
    expect(`${r.out}${r.err}`).toMatch(/根拠の事実カード: p-[0-9a-f]{12} domain1 3 件\(不足。目安 4 件\)/);
  });

  it("根拠にできるカードが目安以上_不足とは報告しない。主張の本文を出さない", async () => {
    const r = await runPlan(5);
    expect(r.code).toBe(EXIT.ok);
    const text = `${r.out}${r.err}`;
    expect(text).toMatch(/根拠の事実カード: p-[0-9a-f]{12} domain1 5 件\n/);
    expect(text).not.toContain("バケット");
  });
});
