import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { ProvenanceFile } from "../draft/provenance.ts";
import { type DraftRecord, readDrafts, writeDrafts } from "../draft/store.ts";
import { baseConfig, choiceDraft, EXAM, runMain, setupDraftRoot, workPath } from "../draft/test-helpers.ts";
import { selectExportable } from "../export/export.ts";
import { emptyFacts, type FactCard, factsPath, writeFacts } from "../facts/schema.ts";
import { card } from "../facts/test-helpers.ts";
import { readAgentStamp } from "../shared/agents.ts";
import { computeSampling, type SamplingInput, type SamplingSettings, selectReview } from "./plan.ts";
import { readSampling, SamplingRecordSchema, samplingPath } from "./store.ts";

const settings: SamplingSettings = {
  mode: "sample",
  rate: 0.3,
  seed: 1,
  nearHoldMargin: 0.15,
  highRiskScore: 2,
  maxRejectRate: 0.2,
  minDecisions: 5,
};
const HASH = "a".repeat(64);
const GOOD_EVAL = { meetsTargets: true, definitionHash: HASH };

const id = (n: number) => `d-${String(n).padStart(12, "a")}`;
const fid = (n: number) => `f-${String(n).padStart(12, "a")}`;

/** 通過した下書き。論点・出典・警告・類似度で、リスクの点数を決められる */
function passed(n: number, overrides: Partial<DraftRecord> = {}, factN = n): DraftRecord {
  return {
    id: id(n),
    planItemId: "p-aaaaaaaaaaaa",
    domain: "domain1",
    difficulty: "easy",
    status: "passed",
    reasons: [],
    warnings: [],
    similarity: 0,
    draft: choiceDraft({ questionText: `抜き取りの架空の設問 ${n}`, factIds: [fid(factN)] }),
    ...overrides,
  };
}

function cardFor(n: number, overrides: Partial<FactCard> = {}): FactCard {
  return card({ id: fid(n), domain: "domain1", scopeItems: [n], confidence: "high", ...overrides });
}

const noProvenance: ProvenanceFile = { examCode: EXAM, entries: [] };
/** 出典が 2 件ある来歴(出典が 1 件だけ、ではない) */
function provenanceOf(drafts: DraftRecord[]): ProvenanceFile {
  const source = {
    url: "https://docs.aws.amazon.com/guide/service.html",
    fetchedAt: "2026-10-01",
    contentHash: "b".repeat(64),
  };
  return {
    examCode: EXAM,
    entries: drafts.map((d) => ({
      draftId: d.id,
      factIds: d.draft?.factIds ?? [],
      sources: [source, { ...source, url: "https://docs.aws.amazon.com/guide/other.html" }],
    })),
  } as unknown as ProvenanceFile;
}

function input(drafts: DraftRecord[], overrides: Partial<SamplingInput> = {}, cards?: FactCard[]): SamplingInput {
  return {
    settings,
    holdThreshold: 0.6,
    drafts: { examCode: EXAM, drafts },
    facts: { ...emptyFacts(EXAM), cards: cards ?? drafts.map((_d, i) => cardFor(i + 1)) },
    provenance: provenanceOf(drafts),
    decisions: { examCode: EXAM, decisions: [] },
    evalSummary: GOOD_EVAL,
    verifierDefinitionHash: HASH,
    previous: null,
    ...overrides,
  };
}

const many = (n: number) => Array.from({ length: n }, (_, i) => passed(i + 1));

describe("抜き取りの選び方", () => {
  it("同じ入力・同じ率・同じ種_同じものが選ばれる。種を変えると選ばれるものが変わる", () => {
    const items = Array.from({ length: 40 }, (_, i) => ({ id: id(i + 1), score: 0 }));
    const a = selectReview(items, { rate: 0.25, seed: 1, highRiskScore: 2 }, "draft");
    const b = selectReview(items, { rate: 0.25, seed: 1, highRiskScore: 2 }, "draft");
    expect(b).toEqual(a);
    expect(a.reviewed).toHaveLength(10);
    expect(a.notReviewed).toHaveLength(30);
    expect([...a.reviewed, ...a.notReviewed].sort()).toEqual(items.map((i) => i.id).sort());
    const c = selectReview(items, { rate: 0.25, seed: 2, highRiskScore: 2 }, "draft");
    expect(c.reviewed).not.toEqual(a.reviewed);
  });

  it("率の境界_率 0 はリスクの高いものだけ、率 1 はすべて。件数は切り上げる", () => {
    const items = [
      { id: id(1), score: 3 },
      { id: id(2), score: 2 },
      { id: id(3), score: 1 },
      { id: id(4), score: 0 },
    ];
    const pick = (rate: number) => selectReview(items, { rate, seed: 1, highRiskScore: 2 }, "draft");
    expect(pick(0).reviewed).toEqual([id(1), id(2)]);
    expect(pick(1).reviewed).toEqual(items.map((i) => i.id));
    expect(pick(1).notReviewed).toEqual([]);
    // 率 0.25 は 4 件の 25% = 1 件だが、リスクの高いもの(点数 2 以上)は 2 件あるので、2 件
    expect(pick(0.25).reviewed).toEqual([id(1), id(2)]);
    // 率 0.5 は 2 件、率 0.6 は切り上げて 3 件(3 件目は点数の高い順に、点数 1 のもの)
    expect(pick(0.5).reviewed).toHaveLength(2);
    expect(pick(0.6).reviewed).toEqual([id(1), id(2), id(3)]);
    expect(selectReview([], { rate: 0.3, seed: 1, highRiskScore: 2 }, "draft")).toEqual({
      eligible: 0,
      reviewed: [],
      notReviewed: [],
    });
  });

  it("リスクの高いもの_率が低くても全件を確認し、確認する件数の残りも点数の高い順に選ぶ", () => {
    const items = Array.from({ length: 20 }, (_, i) => ({ id: id(i + 1), score: i < 3 ? 3 : i < 8 ? 1 : 0 }));
    const r = selectReview(items, { rate: 0.4, seed: 1, highRiskScore: 2 }, "draft");
    expect(r.reviewed).toHaveLength(8);
    for (let i = 1; i <= 8; i++) expect(r.reviewed).toContain(id(i));
  });
});

describe("抜き取りの計画", () => {
  it("設定が全件の確認_通過したものはすべて確認し、確認しないものは 0 件", () => {
    const plan = computeSampling(input(many(10), { settings: { ...settings, mode: "full" } }));
    expect(plan).toMatchObject({ mode: "full", requested: "full", fallback: "not-requested" });
    expect(plan.draft.reviewed).toHaveLength(10);
    expect(plan.draft.notReviewed).toEqual([]);
    expect(plan.fact.notReviewed).toEqual([]);
  });

  it("非公開の問題の書き直しの下書き_抜き取りでも必ず確認する(率 0 でも、確認しないものに入れない)", () => {
    const drafts = [...many(9), passed(10, { rewriteOf: "AIB-0001" })];
    const plan = computeSampling(input(drafts, { settings: { ...settings, rate: 0 } }));
    expect(plan.mode).toBe("sample");
    expect(plan.draft.reviewed).toContain(id(10));
    expect(plan.draft.notReviewed).not.toContain(id(10));
    expect(plan.draft.reviewed.length + plan.draft.notReviewed.length).toBe(10);
  });

  it("切り替えの条件_評価のレポートがない・目標を満たさない・検証役の定義が変わった_全件の確認のままで、理由を持つ", () => {
    const run = (overrides: Partial<SamplingInput>) => computeSampling(input(many(10), overrides));
    expect(run({ evalSummary: null })).toMatchObject({ mode: "full", fallback: "eval-missing" });
    expect(run({ evalSummary: { meetsTargets: false, definitionHash: HASH } })).toMatchObject({
      mode: "full",
      fallback: "eval-not-met",
    });
    expect(run({ verifierDefinitionHash: "c".repeat(64) })).toMatchObject({ mode: "full", fallback: "eval-stale" });
    const ok = run({});
    expect(ok).toMatchObject({ mode: "sample", fallback: null, requested: "sample" });
    expect(ok.draft.notReviewed.length).toBeGreaterThan(0);
  });

  it("保留と不採用_抜き取りの対象にならない(保留は人が解くまで先へ進めない)", () => {
    const list = [
      ...many(6),
      passed(7, { status: "held", reasons: ["review:similar-existing"] }),
      passed(8, { status: "rejected", reasons: ["style:x"], draft: null }),
    ];
    const plan = computeSampling(
      input(
        list,
        { settings: { ...settings, rate: 0 } },
        list.map((_d, i) => cardFor(i + 1)),
      ),
    );
    expect(plan.draft.eligible).toBe(6);
    const all = [...plan.draft.reviewed, ...plan.draft.notReviewed];
    expect(all).not.toContain(id(7));
    expect(all).not.toContain(id(8));
  });

  it("リスクの指標_警告・保留に近い類似度(境界)・新しい論点・出典が 1 件だけ・確度が低い事実カード", () => {
    const threshold = 0.6 - settings.nearHoldMargin;
    const base = (n: number) => passed(n, { warnings: [], similarity: 0 });
    // 同じ論点を承認済みにして、新しい論点ではなくする(論点は、事実カードの出題範囲の項目)
    const approvedDecisions = {
      examCode: EXAM,
      decisions: [1, 2, 3, 4, 5].map((n) => ({
        target: "draft" as const,
        id: id(n),
        decision: "approve" as const,
        reason: "ok",
      })),
    };
    const list = [1, 2, 3, 4, 5]
      .map(base)
      .concat([
        passed(6, { warnings: [{ rule: "r", path: "p" }] }, 1),
        passed(7, { similarity: threshold }, 1),
        passed(8, { similarity: threshold - 0.01 }, 1),
      ]);
    const cards = [1, 2, 3, 4, 5].map((n) => cardFor(n));
    const score = (n: number) => {
      // 点数ごとの選ばれ方を見るため、率 0 で、リスクの高いものだけを数える
      const plan = computeSampling(
        input(list, { settings: { ...settings, rate: 0, highRiskScore: 1 }, decisions: approvedDecisions }, cards),
      );
      return plan.draft.reviewed.includes(id(n));
    };
    // 論点は承認済みで、出典は 2 件: 警告のある 6、類似度がちょうど「保留に近い」境界の 7 が選ばれ、直下の 8 は選ばれない
    expect(score(6)).toBe(true);
    expect(score(7)).toBe(true);
    expect(score(8)).toBe(false);
    // 出典が 1 件だけ(来歴がない)なら点数が上がる
    const single = computeSampling(
      input(
        list,
        {
          settings: { ...settings, rate: 0, highRiskScore: 1 },
          decisions: approvedDecisions,
          provenance: noProvenance,
        },
        cards,
      ),
    );
    expect(single.draft.reviewed).toContain(id(8));
    // 事実カードは、確度が medium か low のものが、点数が高い
    const factCards = [cardFor(1), cardFor(2, { confidence: "low" })];
    const factsPlan = computeSampling(
      input(
        [],
        { settings: { ...settings, rate: 0, highRiskScore: 2 } },
        factCards.map((c) => ({ ...c, sources: [...c.sources, ...c.sources] })),
      ),
    );
    expect(factsPlan.fact.reviewed).toContain(fid(2));
  });

  it("新しい論点_人が承認した下書きがまだ扱っていない論点は、点数が上がる", () => {
    const list = [passed(1), passed(2)];
    const cards = [cardFor(1), cardFor(2)];
    const plan = (approvedIds: string[]) =>
      computeSampling(
        input(
          list,
          {
            settings: { ...settings, rate: 0, highRiskScore: 1 },
            decisions: {
              examCode: EXAM,
              decisions: approvedIds.map((i) => ({
                target: "draft" as const,
                id: i,
                decision: "approve" as const,
                reason: "ok",
              })),
            },
          },
          cards,
        ),
      ).draft.reviewed;
    expect(plan([])).toEqual([id(1), id(2)]);
    // 1 つ目を承認すると、その論点は新しくなくなる(2 つ目は、まだ新しい論点)
    expect(plan([id(1)])).toEqual([id(2)]);
    expect(plan([id(1), id(2)])).toEqual([]);
  });

  it("却下の割合_前回確認するとした下書きの判断で、上限を超えたら全件の確認へ戻す。ちょうど上限と、判断が足りないときは戻さない", () => {
    const list = many(10);
    const reviewedIds = list.map((d) => d.id);
    const decide = (approve: number, reject: number) => ({
      examCode: EXAM,
      decisions: [
        ...reviewedIds
          .slice(0, approve)
          .map((i) => ({ target: "draft" as const, id: i, decision: "approve" as const, reason: "ok" })),
        ...reviewedIds
          .slice(approve, approve + reject)
          .map((i) => ({ target: "draft" as const, id: i, decision: "reject" as const, reason: "bad" })),
      ],
    });
    const run = (approve: number, reject: number) =>
      computeSampling(input(list, { decisions: decide(approve, reject), previous: { reviewedDraftIds: reviewedIds } }));
    // 判断 5 件で、却下 1 件 = 0.2(ちょうど上限): 抜き取りのまま
    expect(run(4, 1)).toMatchObject({ mode: "sample", rejectRate: 0.2 });
    // 却下 2 件 / 6 件 = 0.33: 全件の確認へ戻す
    expect(run(4, 2)).toMatchObject({ mode: "full", fallback: "reject-rate-high" });
    // 判断が最小の件数(5)に満たないときは、割合を測らない
    expect(run(3, 1)).toMatchObject({ mode: "sample", rejectRate: null });
  });
});

// ---- コマンドと記録 ----

function sampleConfig(rate: number) {
  return { review: { ...baseConfig.review, mode: "sample", rate, highRiskScore: 4 } };
}

/** 検証を通った通過の下書きを n 件置き、検証役の評価が目標を満たしたレポートを置く */
function setupSampleRoot(n: number, evalHash?: string) {
  const root = setupDraftRoot();
  const list = Array.from({ length: n }, (_, i) =>
    passed(i + 1, { verification: { verdict: "pass", reasons: [], findings: [], checks: {} } }, 1),
  );
  mkdirSync(workPath(root), { recursive: true });
  writeDrafts(workPath(root, "drafts.json"), { examCode: EXAM, drafts: list });
  writeFacts(factsPath(join(root, baseConfig.factsDir), EXAM), {
    ...emptyFacts(EXAM),
    cards: [
      cardFor(1),
      cardFor(2, { confidence: "low" }),
      cardFor(3),
      cardFor(4),
      cardFor(5),
      cardFor(6),
      cardFor(7),
      cardFor(8),
    ],
  });
  const dir = join(root, baseConfig.workDir, "eval", "aws-aib-c01");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "report.json"),
    JSON.stringify({
      agent: { definitionHash: evalHash ?? readAgentStamp(root, "question-verifier").definitionHash },
      metrics: { meetsTargets: true },
    }),
  );
  return { root, list };
}

describe("draft --review の抜き取り", () => {
  it("評価が目標を満たした_確認用の表とシートに選んだものだけを出し、抜き取りの記録を判断の記録のそばに残す。本文の写しは載らない", async () => {
    const { root, list } = setupSampleRoot(10);
    const r = await runMain(root, ["draft", EXAM, "--review"], sampleConfig(0.2));
    expect(r.code).toBe(0);
    const record = readSampling(samplingPath(join(root, baseConfig.decisionsDir), EXAM), EXAM);
    expect(record).not.toBeNull();
    expect(SamplingRecordSchema.safeParse(record).success).toBe(true);
    expect(record).toMatchObject({ mode: "sample", rate: 0.2, seed: baseConfig.review.seed, fallback: null });
    expect(record?.draft.eligible).toBe(10);
    expect((record?.draft.reviewed.length ?? 0) + (record?.draft.notReviewed.length ?? 0)).toBe(10);
    expect(record?.draft.notReviewed.length).toBeGreaterThan(0);
    const sheet = JSON.parse(readFileSync(workPath(root, "review-sheet.json"), "utf8"));
    expect(sheet.items.map((i: { id: string }) => i.id).sort()).toEqual(record?.draft.reviewed);
    const table = readFileSync(workPath(root, "review.md"), "utf8");
    for (const skipped of record?.draft.notReviewed ?? []) expect(table).not.toContain(skipped);
    for (const shown of record?.draft.reviewed ?? []) expect(table).toContain(shown);
    expect(table).toContain("抜き取りで確認する");
    expect(r.out).toContain("抜き取り(率 0.2");
    expect(table).not.toContain("up to 100 buckets");
    expect(list.length).toBe(10);
    // 記録に本文は含まれない
    expect(readFileSync(samplingPath(join(root, baseConfig.decisionsDir), EXAM), "utf8")).not.toContain(
      "抜き取りの架空の設問",
    );
  });

  it("評価のレポートがない_全件の確認のままで、理由を報告し、記録に残す", async () => {
    const { root } = setupSampleRoot(6);
    rmReport(root);
    const r = await runMain(root, ["draft", EXAM, "--review"], sampleConfig(0.2));
    expect(r.out).toContain("全件の確認(理由 eval-missing)");
    const record = readSampling(samplingPath(join(root, baseConfig.decisionsDir), EXAM), EXAM);
    expect(record).toMatchObject({ mode: "full", requested: "sample", fallback: "eval-missing" });
    expect(record?.draft.notReviewed).toEqual([]);
    const sheet = JSON.parse(readFileSync(workPath(root, "review-sheet.json"), "utf8"));
    expect(sheet.items).toHaveLength(6);
  });

  it("設定が全件の確認(既定)_これまでどおり、通過した下書きをすべて出す", async () => {
    const { root } = setupSampleRoot(6);
    await runMain(root, ["draft", EXAM, "--review"]);
    const record = readSampling(samplingPath(join(root, baseConfig.decisionsDir), EXAM), EXAM);
    expect(record).toMatchObject({ mode: "full", fallback: "not-requested" });
    expect(JSON.parse(readFileSync(workPath(root, "review-sheet.json"), "utf8")).items).toHaveLength(6);
  });

  it("記録のあとに判断を取り込む_確認の対象は記録のとおりで、判断が増えても変わらない", async () => {
    const { root } = setupSampleRoot(10);
    await runMain(root, ["draft", EXAM, "--review"], sampleConfig(0.2));
    const record = readSampling(samplingPath(join(root, baseConfig.decisionsDir), EXAM), EXAM);
    const sheetPath = workPath(root, "review-sheet.json");
    const sheet = JSON.parse(readFileSync(sheetPath, "utf8"));
    sheet.items[0].decision = "approve";
    sheet.items[0].reason = "reviewed";
    writeFileSync(sheetPath, JSON.stringify(sheet));
    const r = await runMain(root, ["draft", EXAM, "--decide"], sampleConfig(0.2));
    expect(r.out).toContain(`人の確認: 対象 ${record?.draft.reviewed.length} 件、承認 1 件`);
  });

  it("壊れた抜き取りの記録_場所だけを報告して終了コード 1 になる(書き出し)", async () => {
    const { root } = setupSampleRoot(4);
    mkdirSync(join(root, baseConfig.decisionsDir), { recursive: true });
    writeFileSync(samplingPath(join(root, baseConfig.decisionsDir), EXAM), '{"examCode": 1}');
    const r = await runMain(root, ["export", EXAM]);
    expect(r.code).toBe(1);
    expect(r.err).toContain("抜き取りの記録の誤り:");
  });
});

function rmReport(root: string) {
  writeFileSync(join(root, baseConfig.workDir, "eval", "aws-aib-c01", "report.json"), "{}");
}

describe("書き出しと抜き取り", () => {
  const verified = { verdict: "pass" as const, reasons: [], findings: [], checks: {} };
  const records = [1, 2, 3].map((n) => passed(n, { verification: verified }));
  const entries = {
    examCode: EXAM,
    entries: records.map((d) => ({ draftId: d.id, factIds: [fid(1)], sources: [] })),
  } as unknown as ProvenanceFile;
  const approve = (ids: string[]) => ({
    examCode: EXAM,
    decisions: ids.map((i) => ({ target: "draft" as const, id: i, decision: "approve" as const, reason: "ok" })),
  });

  it("抜き取りで確認しないと記録した下書き_検証を通っていれば、承認なしで書き出せる。確認するもので承認がないものは書き出せない", () => {
    const r = selectExportable(records, approve([]), entries, new Set(), new Set([id(2), id(3)]));
    expect(r.ready.map((d) => d.id)).toEqual([id(2), id(3)]);
    expect(r.notApproved).toBe(1);
  });

  it("確認しないものでも_検証を通っていない下書きは書き出せない。検証が保留のものは、承認があるときだけ", () => {
    const list = [
      passed(1),
      passed(2, { verification: { ...verified, verdict: "hold" } }),
      passed(3, { verification: verified }),
    ];
    const r = selectExportable(list, approve([]), entries, new Set(), new Set([id(1), id(2), id(3)]));
    expect(r.ready.map((d) => d.id)).toEqual([id(3)]);
    expect(r.unverified).toBe(2);
  });

  it("人が却下した下書き_確認しないと記録されていても、書き出さない", () => {
    const rejected = passed(1, {
      verification: verified,
      status: "rejected",
      draft: null,
      reasons: ["human-rejected"],
    });
    const r = selectExportable([rejected], approve([]), entries, new Set(), new Set([id(1)]));
    expect(r.ready).toEqual([]);
  });
});

describe("事実カードの確認用の表と抜き取り", () => {
  it("抜き取り_確認しないと決めた通過のカードは表に載せず、保留のカードは全件載せる", async () => {
    const { root } = setupSampleRoot(4);
    const cards = [1, 2, 3, 4, 5, 6, 7, 8].map((n) =>
      cardFor(n, n === 8 ? { status: "held", reasons: ["conflict"] } : {}),
    );
    writeFacts(factsPath(join(root, baseConfig.factsDir), EXAM), { ...emptyFacts(EXAM), cards });
    await runMain(root, ["draft", EXAM, "--review"], sampleConfig(0));
    const record = readSampling(samplingPath(join(root, baseConfig.decisionsDir), EXAM), EXAM);
    expect(record?.fact.notReviewed.length).toBeGreaterThan(0);
    const r = await runMain(root, ["facts", EXAM, "--report"], sampleConfig(0));
    expect(r.code).toBe(0);
    const table = readFileSync(join(root, baseConfig.workDir, "facts", "aws-aib-c01", "cards.md"), "utf8");
    for (const skipped of record?.fact.notReviewed ?? []) expect(table).not.toContain(skipped);
    expect(table).toContain(fid(8));
    expect(table).toContain("確認しない通過のカード");
  });
});

describe("設問文の類似度の記録", () => {
  it("下書きを取り込む_公開済みの問題やほかの下書きとの最大の類似度を、下書きの記録に残す", async () => {
    const root = setupDraftRoot();
    await runMain(root, ["plan", EXAM]);
    await runMain(root, ["draft", EXAM]);
    const { readChoiceRequests, writeOutput, draftFor } = await import("../draft/test-helpers.ts");
    const request = readChoiceRequests(root)[0] as ReturnType<typeof readChoiceRequests>[number];
    writeOutput(root, request, [draftFor(request)]);
    await runMain(root, ["draft", EXAM, "--import"]);
    const stored = readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0];
    expect(stored?.similarity).toBeGreaterThanOrEqual(0);
    expect(stored?.similarity).toBeLessThanOrEqual(1);
  });
});
