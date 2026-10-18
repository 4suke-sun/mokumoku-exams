import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionsPath, writeDecisions } from "../decisions/decisions.ts";
import { type DraftRecord, readDrafts, writeDrafts } from "../draft/store.ts";
import { baseConfig, choiceDraft, EXAM, runMain, setupDraftRoot, workPath } from "../draft/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { emptyFacts, type FactCard, factsPath, writeFacts } from "../facts/schema.ts";
import { card } from "../facts/test-helpers.ts";
import { VERIFY_CODES } from "../verify/schema.ts";
import { aggregate, MAX_IDS, renderSummary } from "./aggregate.ts";
import { DESCRIBED_CODES, describeReason, hasDescription } from "./catalog.ts";

const SECRET_BODY = "架空の設問文の本文(集計に出てはいけない)";

function draftRecord(n: number, overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    id: `d-${String(n).padStart(12, "a")}`,
    planItemId: "p-aaaaaaaaaaaa",
    domain: "domain1",
    difficulty: "easy",
    status: "rejected",
    reasons: [],
    warnings: [],
    draft: null,
    ...overrides,
  };
}

const facts = (cards: FactCard[]) => ({ ...emptyFacts(EXAM), cards });
const drafts = (list: DraftRecord[]) => ({ examCode: EXAM, drafts: list });
const noDecisions = { examCode: EXAM, decisions: [] };

describe("理由の集計", () => {
  it("判定の記録が空_エラーにならず、空の集計を返す", () => {
    const s = aggregate(EXAM, facts([]), drafts([]), noDecisions);
    expect(s.reasons).toEqual([]);
    expect(s.domains).toEqual([]);
    expect(s.human).toEqual([]);
    expect(s.stages.every((row) => row.total === 0)).toBe(true);
    expect(renderSummary(s)).toContain("保留・不採用・差し戻しの理由はありません。");
  });

  it("理由コードごと_件数と割合(その段階の件数に対する)を、手計算の期待値と合わせる", () => {
    const list = [
      draftRecord(1, { reasons: ["style:question-form"] }),
      draftRecord(2, { reasons: ["style:question-form", "distractor:missing"] }),
      draftRecord(3, { status: "held", reasons: ["ambiguous:similar-to-correct"], draft: choiceDraft() }),
      draftRecord(4, { status: "passed", draft: choiceDraft() }),
    ];
    const s = aggregate(EXAM, facts([]), drafts(list), noDecisions);
    const row = (code: string) => s.reasons.find((r) => r.code === code);
    expect(s.stages.find((x) => x.stage === "draft")).toMatchObject({ total: 4, passed: 1, held: 1, rejected: 2 });
    expect(row("style:question-form")).toMatchObject({ stage: "draft", count: 2, ratio: 0.5, rejected: 2, held: 0 });
    expect(row("distractor:missing")).toMatchObject({ count: 1, ratio: 0.25 });
    expect(row("ambiguous:similar-to-correct")).toMatchObject({ count: 1, held: 1, rejected: 0 });
    // 件数の多い順
    expect(s.reasons[0]?.code).toBe("style:question-form");
  });

  it("段階ごと_事実カード・下書き・検証・人の確認に分け、verify: は検証、human-rejected は人の確認に数える", () => {
    const cards = [
      card({ id: "f-aaaaaaaaaaa1", status: "rejected", reasons: ["number-mismatch"], domain: "domain2" }),
      card({ id: "f-aaaaaaaaaaa2", status: "held", reasons: ["conflict"] }),
      card({ id: "f-aaaaaaaaaaa3", status: "rejected", reasons: ["human-rejected"] }),
      card({ id: "f-aaaaaaaaaaa4" }),
    ];
    const list = [
      draftRecord(1, {
        status: "held",
        reasons: ["verify:answer-mismatch"],
        draft: choiceDraft(),
        verification: { verdict: "hold", reasons: ["verify:answer-mismatch"], findings: [], checks: {} },
      }),
      draftRecord(2, { reasons: ["human-rejected"] }),
    ];
    const decisions = {
      examCode: EXAM,
      decisions: [
        { target: "draft" as const, id: list[1]?.id as string, decision: "reject" as const, reason: "wrong-fact" },
        { target: "draft" as const, id: "d-aaaaaaaaaaa9", decision: "approve" as const, reason: "reviewed" },
      ],
    };
    const s = aggregate(EXAM, facts(cards), drafts(list), decisions);
    const stageOf = (code: string) => s.reasons.find((r) => r.code === code)?.stage;
    expect(stageOf("number-mismatch")).toBe("facts");
    expect(stageOf("verify:answer-mismatch")).toBe("verify");
    expect(s.reasons.filter((r) => r.code === "human-rejected").map((r) => r.stage)).toEqual(["human"]);
    expect(s.stages.find((x) => x.stage === "verify")).toMatchObject({ total: 1, held: 1 });
    expect(s.stages.find((x) => x.stage === "human")).toMatchObject({ total: 2, passed: 1, rejected: 1 });
    expect(s.human).toEqual([
      { target: "draft", decision: "approve", reason: "reviewed", count: 1 },
      { target: "draft", decision: "reject", reason: "wrong-fact", count: 1 },
    ]);
  });

  it("検証の段階の件数_判定が出たものだけを数え、判定なし・解説の確認待ち(null)は数えない。人が承認しても、検証の判定で数える", () => {
    const v = (verdict: "pass" | "hold" | "reject" | null, reasons: string[] = []) => ({
      verdict,
      reasons,
      findings: [],
      checks: {},
    });
    const list = [
      draftRecord(1, { status: "passed", draft: choiceDraft(), verification: v("pass") }),
      draftRecord(2, { status: "passed", draft: choiceDraft(), verification: v(null) }),
      // 検証は保留で、人が承認して通過になった
      draftRecord(3, { status: "passed", draft: choiceDraft(), verification: v("hold", ["verify:overclaim"]) }),
      draftRecord(4, { reasons: ["verify:copy"], verification: v("reject", ["verify:copy"]) }),
      draftRecord(5, { status: "passed", draft: choiceDraft() }),
    ];
    const s = aggregate(EXAM, facts([]), drafts(list), noDecisions);
    expect(s.stages.find((x) => x.stage === "verify")).toEqual({
      stage: "verify",
      total: 3,
      passed: 1,
      held: 1,
      rejected: 1,
    });
  });

  it("論点(分野)ごと_理由ごとの件数と、分野ごとの保留・不採用の件数を出す", () => {
    const cards = [
      card({ id: "f-aaaaaaaaaaa1", status: "rejected", reasons: ["long-copy"], domain: "domain1" }),
      card({ id: "f-aaaaaaaaaaa2", status: "rejected", reasons: ["long-copy"], domain: "domain2" }),
      card({ id: "f-aaaaaaaaaaa3", status: "rejected", reasons: ["long-copy", "number-mismatch"], domain: "domain2" }),
    ];
    const s = aggregate(EXAM, facts(cards), drafts([]), noDecisions);
    expect(s.reasons.find((r) => r.code === "long-copy")?.byDomain).toEqual({ domain1: 1, domain2: 2 });
    expect(s.domains).toEqual([
      { stage: "facts", domain: "domain1", total: 1, held: 0, rejected: 1 },
      { stage: "facts", domain: "domain2", total: 2, held: 0, rejected: 2 },
    ]);
  });

  it("理由ごとの ID_昇順で上限(MAX_IDS)まで。上限ちょうどと超過で切る", () => {
    const make = (n: number) =>
      Array.from({ length: n }, (_, i) => draftRecord(i + 1, { reasons: ["style:question-form"] }));
    const ids = (n: number) => aggregate(EXAM, facts([]), drafts(make(n)), noDecisions).reasons[0]?.ids ?? [];
    expect(ids(MAX_IDS)).toHaveLength(MAX_IDS);
    expect(ids(MAX_IDS + 1)).toHaveLength(MAX_IDS);
    expect(ids(MAX_IDS + 1)).toEqual([...ids(MAX_IDS + 1)].sort());
  });

  it("同じ入力_同じ集計と同じ要約になる。要約に問題の本文・選択肢は含まれない", () => {
    const list = [
      draftRecord(1, { reasons: ["style:question-form"], draft: null }),
      draftRecord(2, {
        status: "held",
        reasons: ["ambiguous:similar-to-correct"],
        draft: choiceDraft({ questionText: SECRET_BODY }),
      }),
    ];
    const a = aggregate(EXAM, facts([]), drafts(list), noDecisions);
    const b = aggregate(EXAM, facts([]), drafts([...list].reverse()), noDecisions);
    expect(b).toEqual(a);
    const text = renderSummary(a) + JSON.stringify(a);
    expect(text).not.toContain(SECRET_BODY);
    expect(text).not.toContain("10 個");
  });

  it("要約_理由の意味・よくある型・指示に足す制約の候補を持つ", () => {
    const s = aggregate(EXAM, facts([]), drafts([draftRecord(1, { reasons: ["style:question-form"] })]), noDecisions);
    expect(s.reasons[0]?.meaning).toContain("スタイル規則");
    expect(s.reasons[0]?.suggestion).toContain("styleRules");
    const md = renderSummary(s);
    expect(md).toContain("- 意味:");
    expect(md).toContain("- よくある型:");
    expect(md).toContain("- 指示に足すとよい制約の候補:");
  });
});

describe("理由コードの説明", () => {
  it("検証の理由コード_すべてに完全一致の説明がある", () => {
    for (const code of VERIFY_CODES) expect(hasDescription(`verify:${code}`), code).toBe(true);
    expect(DESCRIBED_CODES).toContain("verify:copy");
  });

  it("接頭辞で引く理由コード_style・distractor・data-invalid・duplicate などに説明がある。知らないコードは説明なし", () => {
    for (const code of [
      "style:x",
      "distractor:x",
      "provenance:x",
      "data-invalid:root",
      "duplicate:similar-existing",
      "review:topic-draft",
      "ambiguous:x",
    ]) {
      expect(hasDescription(code), code).toBe(true);
    }
    expect(hasDescription("no-such-code")).toBe(false);
    expect(describeReason("no-such-code").meaning).toBe("(説明なし)");
  });

  it("文書の理由コードの表_表に載る理由コードの説明が、すべてある", () => {
    const doc = readFileSync(join(import.meta.dirname, "../../../../docs/drafting.md"), "utf8");
    const table = doc.slice(doc.indexOf("## 4. 判定と理由コード"));
    const codes = [...table.matchAll(/^\| `([a-z][a-z0-9:-]*(?:[:<][^`]*)?)`/gm)].map((m) => m[1] as string);
    expect(codes.length).toBeGreaterThan(5);
    for (const raw of codes) {
      // `style:<規則>` `duplicate:similar-existing` / `duplicate:similar-draft` などの表記から、先頭の理由コードを取り出す
      const code = raw.replace(/<.*$/, "");
      expect(hasDescription(code), raw).toBe(true);
    }
  });
});

describe("reasons コマンド", () => {
  async function withRecords() {
    const root = setupDraftRoot();
    writeFacts(factsPath(join(root, baseConfig.factsDir), EXAM), {
      ...emptyFacts(EXAM),
      cards: [
        card({ id: "f-aaaaaaaaaaa1", status: "rejected", reasons: ["number-mismatch"] }),
        card({ id: "f-aaaaaaaaaaa2" }),
      ],
    });
    mkdirSync(workPath(root), { recursive: true });
    writeDrafts(workPath(root, "drafts.json"), drafts([draftRecord(1, { reasons: ["style:question-form"] })]));
    writeDecisions(decisionsPath(join(root, baseConfig.decisionsDir), EXAM), {
      examCode: EXAM,
      decisions: [{ target: "draft", id: draftRecord(1).id, decision: "reject", reason: "wrong-fact" }],
    });
    return root;
  }

  it("記録がある_集計を作業用の置き場に JSON と要約で書き、報告は件数と理由コードだけ", async () => {
    const root = await withRecords();
    const r = await runMain(root, ["reasons", EXAM]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("理由の集計: 理由 draft style:question-form 1 件 100.0%");
    expect(r.out).toContain("理由の集計: 理由 facts number-mismatch 1 件 50.0%");
    const dir = join(root, baseConfig.workDir, "reasons", "aws-aib-c01");
    const json = JSON.parse(readFileSync(join(dir, "summary.json"), "utf8"));
    expect(json.reasons.map((x: { code: string }) => x.code).sort()).toEqual([
      "number-mismatch",
      "style:question-form",
    ]);
    expect(readFileSync(join(dir, "summary.md"), "utf8")).toContain("# 不採用と差し戻しの理由の集計");
  });

  it("実行しても元の記録が変わらない_事実カード・下書き・判断の記録を書き換えない", async () => {
    const root = await withRecords();
    const files = [
      factsPath(join(root, baseConfig.factsDir), EXAM),
      workPath(root, "drafts.json"),
      decisionsPath(join(root, baseConfig.decisionsDir), EXAM),
    ];
    const before = files.map((f) => readFileSync(f, "utf8"));
    await runMain(root, ["reasons", EXAM]);
    expect(files.map((f) => readFileSync(f, "utf8"))).toEqual(before);
    expect(readDrafts(workPath(root, "drafts.json"), EXAM).drafts).toHaveLength(1);
  });

  it("記録が何もない_空の集計で成功する", async () => {
    const root = setupDraftRoot({ cards: [] });
    const r = await runMain(root, ["reasons", EXAM]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("空の集計");
  });

  it("dry-run_書き込まない", async () => {
    const root = await withRecords();
    const r = await runMain(root, ["reasons", EXAM, "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("書き込みをしない(dry-run)");
    expect(() => readFileSync(join(root, baseConfig.workDir, "reasons", "aws-aib-c01", "summary.md"))).toThrow();
  });

  it("壊れた記録_場所だけを報告して終了コード 1 になる", async () => {
    const root = await withRecords();
    writeFileSync(workPath(root, "drafts.json"), "{壊れた本文");
    const r = await runMain(root, ["reasons", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("下書きの誤り: (JSON の形)");
    expect(r.err + r.out).not.toContain("壊れた本文");
  });

  it("資格コードの指定がない_入力の誤り", async () => {
    expect((await runMain(setupDraftRoot(), ["reasons"])).code).toBe(EXIT.inputError);
  });
});
