import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionsPath, writeDecisions } from "../decisions/decisions.ts";
import { EXIT } from "../exit-codes.ts";
import { card } from "../facts/test-helpers.ts";
import { provenancePath, readProvenance } from "./provenance.ts";
import type { DraftRequest } from "./request.ts";
import { identityOf, rewritePlanItemId, rewriteTargets, sameContentProblems, topicsOf } from "./rewrite.ts";
import {
  FACT_OWN,
  FACT_SAME,
  FACT_SOURCE,
  FACT_TOPIC,
  originalQuestion,
  REWRITE_ID,
  REWRITTEN_TEXT,
  rewriteAndImport,
  rewriteRequests,
  setupRewriteRoot,
} from "./rewrite-test-helpers.ts";
import { type DraftRecord, HUMAN_REJECTED, readDrafts, writeDrafts } from "./store.ts";
import { baseConfig, draftFor, EXAM, readRequests, runMain, workPath, writeOutput } from "./test-helpers.ts";

const entryOf = (verdict: "rewritable" | "unpublish", id = REWRITE_ID) => ({
  verdict,
  reasons: ["judge:choices-weak"],
  question: originalQuestion({ questionId: id }) as never,
});
const record = (overrides: Partial<DraftRecord>): DraftRecord => ({
  id: "d-000000000001",
  planItemId: "p-000000000001",
  domain: "domain1",
  difficulty: "medium",
  status: "passed",
  reasons: [],
  warnings: [],
  draft: null,
  ...overrides,
});

describe("書き直しの対象", () => {
  it("判定が rewritable の問題_対象にし、unpublish の問題は対象にしない", () => {
    const targets = rewriteTargets(
      { examCode: EXAM, entries: [entryOf("rewritable", "AIB-0002"), entryOf("unpublish", "AIB-0001")] },
      [],
    );
    expect(targets.map((t) => t.entry.question.questionId)).toEqual(["AIB-0002"]);
    expect(targets[0]?.round).toBe(0);
  });

  it("書き直しの下書きが生きている問題_対象にしない。却下で不採用になったものだけなら対象にし、回数を数える", () => {
    const unpublished = { examCode: EXAM, entries: [entryOf("rewritable")] };
    expect(rewriteTargets(unpublished, [record({ rewriteOf: REWRITE_ID, status: "held" })])).toEqual([]);
    const rejected = rewriteTargets(unpublished, [
      record({ rewriteOf: REWRITE_ID, status: "rejected", reasons: [HUMAN_REJECTED] }),
    ]);
    expect(rejected.map((t) => t.round)).toEqual([1]);
  });

  it("非公開のファイルがない_対象はない", () => {
    expect(rewriteTargets(null, [])).toEqual([]);
  });

  it("問題の ID_書き直しの計画の項目の ID は、問題の ID ごとに決まる", () => {
    expect(rewritePlanItemId("AIB-0001")).toBe(rewritePlanItemId("AIB-0001"));
    expect(rewritePlanItemId("AIB-0001")).not.toBe(rewritePlanItemId("AIB-0002"));
    expect(rewritePlanItemId("AIB-0001")).toMatch(/^p-[0-9a-f]{12}$/);
  });
});

describe("同じ内容かの比較", () => {
  const base = identityOf({ domain: "domain1", referenceUrls: ["https://a", "https://b"], topics: ["domain1#1"] });

  it("分野・出典・論点が同じ_問題なし(出典と論点の順序と重複は問わない)", () => {
    const same = identityOf({
      domain: "domain1",
      referenceUrls: ["https://b", "https://a", "https://a"],
      topics: ["domain1#1"],
    });
    expect(sameContentProblems(base, same)).toEqual([]);
  });

  it("分野・出典・論点のどれかが違う_違う項目ごとの理由コードを返す", () => {
    const other = identityOf({ domain: "domain2", referenceUrls: ["https://a"], topics: ["domain1#2"] });
    expect(sameContentProblems(base, other)).toEqual([
      "rewrite:domain-changed",
      "rewrite:references-changed",
      "rewrite:topic-changed",
    ]);
  });

  it("論点_根拠の事実カードの分野と出題範囲の項目の組。カードがなければ飛ばす", () => {
    const facts = { examCode: EXAM, extracted: [], cards: [card({ id: "f-00000000000a", scopeItems: [3, 1] })] };
    expect(topicsOf(["f-00000000000a", "f-00000000000f"], facts as never)).toEqual(["domain1#1", "domain1#3"]);
  });
});

describe("draft --rewrite と取り込み", () => {
  const records = (root: string) => readDrafts(workPath(root, "drafts.json"), EXAM).drafts;

  it("非公開の問題_現行の本文・判定の理由・根拠の節の場所・元の根拠を先頭にした事実カードを載せた依頼を 1 件書く", async () => {
    const root = setupRewriteRoot();
    const r = await runMain(root, ["draft", EXAM, "--rewrite"]);
    expect(r.code, r.err).toBe(EXIT.ok);
    const [request] = rewriteRequests(root);
    expect(request?.count).toBe(1);
    expect(request?.rewrite?.questionId).toBe(REWRITE_ID);
    expect(request?.rewrite?.reasons).toEqual(["judge:choices-weak"]);
    expect(request?.rewrite?.factIds).toEqual([FACT_OWN]);
    expect(request?.rewrite?.question.correctAnswers).toEqual(["B"]);
    expect(request?.rewrite?.sections.map((s) => s.heading)).toEqual(["quotas"]);
    expect(request?.facts[0]?.id).toBe(FACT_OWN);
    expect(request?.facts.map((f) => f.id)).toEqual(expect.arrayContaining([FACT_SAME, FACT_TOPIC, FACT_SOURCE]));
    expect(request?.answerPositions).toEqual([["B"]]);
    expect(request?.difficulty).toBe("medium");
    expect(request?.agent?.role).toBe("question-reviser");
    expect(r.out).toContain("書き直しの依頼:");
    const again = await runMain(root, ["draft", EXAM, "--rewrite"]);
    expect(again.out).toContain("書き直しの依頼 0 件、依頼済みで待っている 1 件");
  });

  it("判定が unpublish の問題_書き直しの依頼を書かない", async () => {
    const root = setupRewriteRoot({ verdict: "unpublish" });
    const r = await runMain(root, ["draft", EXAM, "--rewrite"]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain("書き直しの依頼 0 件");
    expect(rewriteRequests(root)).toEqual([]);
  });

  it("来歴のない問題_材料がそろわないので依頼せず、理由を報告して失敗にする", async () => {
    const root = setupRewriteRoot();
    writeFileSync(
      provenancePath(join(root, baseConfig.provenanceDir), EXAM),
      JSON.stringify({ examCode: EXAM, entries: [] }),
    );
    const r = await runMain(root, ["draft", EXAM, "--rewrite"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain(`書き直しの保留: ${REWRITE_ID} no-provenance`);
    expect(rewriteRequests(root)).toEqual([]);
  });

  it("書き直しを取り込む_元の ID を rewriteOf に持つ新しい下書きとして通し、来歴を足す", async () => {
    const root = setupRewriteRoot();
    const draft = await rewriteAndImport(root);
    expect(draft.status).toBe("passed");
    expect(draft.rewriteOf).toBe(REWRITE_ID);
    expect(draft.revisionOf).toBeUndefined();
    expect(draft.agent?.role).toBe("question-reviser");
    const provenance = readProvenance(provenancePath(join(root, baseConfig.provenanceDir), EXAM), EXAM);
    const added = provenance.entries.find((e) => e.draftId === draft.id);
    expect(added?.factIds).toEqual([FACT_OWN]);
    // 元の問題の来歴は、復帰まで残す
    expect(provenance.entries.find((e) => e.questionId === REWRITE_ID)?.draftId).toBe("d-0000000000aa");
  });

  it("出典が元と違う根拠で書き直した_不採用(rewrite:references-changed)", async () => {
    const root = setupRewriteRoot();
    const draft = await rewriteAndImport(root, (request) =>
      draftFor(request, { questionText: REWRITTEN_TEXT, factIds: [FACT_SOURCE] }),
    );
    expect(draft.status).toBe("rejected");
    expect(draft.reasons).toEqual(["rewrite:references-changed"]);
    expect(draft.draft).toBeNull();
    // 検査で不採用になった書き直しは、同じ入力では依頼し直さない(人が却下したときだけ、依頼し直す)
    const again = await runMain(root, ["draft", EXAM, "--rewrite"]);
    expect(again.out).toContain("書き直しの依頼 0 件");
    expect(rewriteRequests(root)).toEqual([]);
  });

  it("論点が元と違う根拠で書き直した_不採用(rewrite:topic-changed)", async () => {
    const root = setupRewriteRoot();
    const draft = await rewriteAndImport(root, (request) =>
      draftFor(request, { questionText: REWRITTEN_TEXT, factIds: [FACT_TOPIC] }),
    );
    expect(draft.status).toBe("rejected");
    expect(draft.reasons).toEqual(["rewrite:topic-changed"]);
  });

  it("依頼のあとに非公開の問題の本文が変わった_取り込まず、依頼を捨てる", async () => {
    const root = setupRewriteRoot();
    await runMain(root, ["draft", EXAM, "--rewrite"]);
    const request = rewriteRequests(root)[0] as DraftRequest;
    writeOutput(root, request, [draftFor(request, { questionText: REWRITTEN_TEXT })]);
    writeFileSync(
      join(root, "data/unpublished.aws-aib-c01.json"),
      JSON.stringify({
        examCode: EXAM,
        entries: [
          {
            verdict: "rewritable",
            reasons: ["judge:choices-weak"],
            question: originalQuestion({ explanation: "解説を変えた。" }),
          },
        ],
      }),
    );
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.err).toContain("request-stale");
    expect(records(root).some((d) => d.rewriteOf !== undefined)).toBe(false);
  });

  it("書き直しの下書きを人が却下した_その問題を、新しい依頼(別の鍵)で書き直せる", async () => {
    const root = setupRewriteRoot();
    const draft = await rewriteAndImport(root);
    const first = rewriteRequests(root);
    expect(first).toEqual([]);
    writeDecisions(decisionsPath(join(root, baseConfig.decisionsDir), EXAM), {
      examCode: EXAM,
      decisions: [{ target: "draft", id: draft.id, decision: "reject", reason: "reviewed" }],
    });
    const r = await runMain(root, ["draft", EXAM, "--rewrite"]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(rewriteRequests(root)).toHaveLength(1);
    expect(records(root).find((d) => d.id === draft.id)?.status).toBe("rejected");
  });

  it("書き直しの下書きがある問題_さらに書き直しの依頼を書かない", async () => {
    const root = setupRewriteRoot();
    await rewriteAndImport(root);
    const r = await runMain(root, ["draft", EXAM, "--rewrite"]);
    expect(r.out).toContain("書き直しの依頼 0 件");
    expect(r.out).toContain("対象 0 件");
  });

  describe("書き直しの下書きの直し(draft --revise)", () => {
    /** 書き直しの下書きを取り込み、検証の保留にして、直しの依頼を書く */
    async function heldRewrite(root: string) {
      const draft = await rewriteAndImport(root);
      const path = workPath(root, "drafts.json");
      const file = readDrafts(path, EXAM);
      writeDrafts(path, {
        ...file,
        drafts: file.drafts.map((d) =>
          d.id === draft.id ? { ...d, status: "held" as const, reasons: ["verify:answer-mismatch"] } : d,
        ),
      });
      await runMain(root, ["draft", EXAM, "--revise"]);
      const request = readRequests(root).find((r) => r.revise !== undefined) as DraftRequest;
      return { draft, request };
    }
    const revisedText = "Widget Store で、リージョンごとに 1 つのアカウントが作れるバケットの上限数は、いくつですか。";

    it("直した下書き_元の問題の ID を引き継ぐ", async () => {
      const root = setupRewriteRoot();
      const { draft, request } = await heldRewrite(root);
      writeOutput(root, request, [draftFor(request, { questionText: revisedText })]);
      await runMain(root, ["draft", EXAM, "--import"]);
      const after = records(root).find((d) => d.revisionOf === draft.id);
      expect(after?.status).toBe("passed");
      expect(after?.rewriteOf).toBe(REWRITE_ID);
    });

    it("直した下書きの出典が元の問題と違う_不採用(rewrite:references-changed)。直す前の下書きは保留のまま残る", async () => {
      const root = setupRewriteRoot();
      const { draft, request } = await heldRewrite(root);
      writeOutput(root, request, [draftFor(request, { questionText: revisedText, factIds: [FACT_SOURCE] })]);
      await runMain(root, ["draft", EXAM, "--import"]);
      const after = records(root).find((d) => d.revisionOf === draft.id);
      expect(after?.status).toBe("rejected");
      expect(after?.reasons).toEqual(["rewrite:references-changed"]);
      expect(records(root).find((d) => d.id === draft.id)?.status).toBe("held");
    });
  });
});
