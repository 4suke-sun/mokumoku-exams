import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionsPath, writeDecisions } from "../decisions/decisions.ts";
import { EXIT } from "../exit-codes.ts";
import type { FactCard } from "../facts/schema.ts";
import { card } from "../facts/test-helpers.ts";
import { planPath, readPlan } from "../plan/schema.ts";
import { provenancePath, readProvenance } from "./provenance.ts";
import type { DraftRequest } from "./request.ts";
import { evidenceLocations, type RevisableRecord, reviseFacts, reviseTargets } from "./revise.ts";
import {
  applyDraftDecisions,
  type DraftRecord,
  type DraftsFile,
  HUMAN_REJECTED,
  REVISED,
  readDrafts,
  usedFactIds,
  writeDrafts,
} from "./store.ts";
import {
  baseConfig,
  choiceDraft,
  draftFor,
  EXAM,
  freeTextDraft,
  readChoiceRequests,
  readRequests,
  runMain,
  setupDraftRoot,
  workPath,
  writeOutput,
} from "./test-helpers.ts";

const URL_A = "https://docs.aws.amazon.com/guide/a.html";
const URL_B = "https://docs.aws.amazon.com/guide/b.html";

function record(overrides: Partial<DraftRecord> = {}): DraftRecord {
  return {
    id: "d-000000000001",
    planItemId: "p-000000000001",
    domain: "domain1",
    difficulty: "medium",
    status: "held",
    reasons: ["verify:answer-mismatch"],
    warnings: [],
    draft: choiceDraft({ factIds: ["f-00000000000a"] }),
    ...overrides,
  };
}

/** 先頭の出典と出題範囲の項目だけを変えた事実カード */
function cardAt(id: string, url: string, scopeItems: number[] = [], heading = "quotas"): FactCard {
  const base = card({ id, scopeItems });
  return { ...base, sources: base.sources.map((s) => ({ ...s, url, anchor: { heading } })) };
}

describe("直す対象", () => {
  it("保留の選択式で人の判断がない下書き_対象にする。通過・不採用・自由記述・判断のある下書きは対象にしない", () => {
    const drafts: DraftsFile = {
      examCode: EXAM,
      drafts: [
        record({ id: "d-000000000001" }),
        record({ id: "d-000000000002", status: "passed", reasons: [] }),
        record({ id: "d-000000000003", status: "rejected", draft: null }),
        record({ id: "d-000000000004", draft: freeTextDraft() }),
        record({ id: "d-000000000005" }),
      ],
    };
    const targets = reviseTargets(drafts, (id) => (id === "d-000000000005" ? "approve" : undefined));
    expect(targets.map((d) => d.id)).toEqual(["d-000000000001"]);
  });

  it("写しを確かめられない保留_直しでは解けないので対象にしない", () => {
    const drafts: DraftsFile = { examCode: EXAM, drafts: [record({ reasons: ["review:copy-unchecked"] })] };
    expect(reviseTargets(drafts, () => undefined)).toEqual([]);
  });
});

describe("根拠の節の場所", () => {
  it("事実カードの先頭の出典_URL・節の名前・見出しを、同じ本文と見出しの重なりを除いて返し、ないカードは飛ばす", () => {
    const facts = {
      examCode: EXAM,
      extracted: [],
      cards: [
        cardAt("f-00000000000a", URL_A),
        cardAt("f-00000000000b", URL_A),
        cardAt("f-00000000000c", URL_B, [], "limits"),
      ],
    };
    expect(evidenceLocations(["f-00000000000c", "f-00000000000b", "f-00000000000a", "f-00000000000f"], facts)).toEqual([
      { url: URL_A, section: "Quotas and limits", heading: "quotas" },
      { url: URL_B, section: "Quotas and limits", heading: "limits" },
    ]);
  });
});

describe("直しの依頼に載せる事実カード", () => {
  const original = record({ draft: choiceDraft({ factIds: ["f-00000000000a"] }) }) as RevisableRecord;
  const own = cardAt("f-00000000000a", URL_A, [3]);
  const sameSource = cardAt("f-00000000000d", URL_A, [9]);
  const sameScope = cardAt("f-00000000000b", URL_B, [3]);
  const other = cardAt("f-00000000000c", URL_B, [7]);

  it("近さの違うカード_元の根拠のカードを先に、続けて同じ出典、同じ出題範囲の項目、それ以外の順に並べる", () => {
    const facts = reviseFacts(original, [other, sameScope, sameSource, own], new Map(), 10);
    expect(facts.map((c) => c.id)).toEqual(["f-00000000000a", "f-00000000000d", "f-00000000000b", "f-00000000000c"]);
  });

  it("同じ近さのカード_根拠にされた回数の少ないものを先にし、上限の件数で切る", () => {
    const other2 = cardAt("f-00000000000e", URL_B, [7]);
    const facts = reviseFacts(original, [own, other, other2], new Map([["f-00000000000c", 2]]), 2);
    expect(facts.map((c) => c.id)).toEqual(["f-00000000000a", "f-00000000000e"]);
  });
});

describe("本文を持たない下書きの根拠", () => {
  it("人が却下した下書き_本文は持たず、根拠の事実カードの ID だけを残し、使用数に数えられる", () => {
    const drafts: DraftsFile = { examCode: EXAM, drafts: [record({ status: "passed", reasons: [] })] };
    const { file } = applyDraftDecisions(drafts, () => "reject");
    const rejected = file.drafts[0] as DraftRecord;
    expect(rejected.status).toBe("rejected");
    expect(rejected.reasons).toEqual([HUMAN_REJECTED]);
    expect(rejected.draft).toBeNull();
    expect(usedFactIds(rejected)).toEqual(["f-00000000000a"]);
  });

  it("本文も残した ID もない不採用の下書き_使用数に数えない", () => {
    expect(usedFactIds(record({ status: "rejected", draft: null }))).toEqual([]);
  });
});

describe("draft --revise と取り込み", () => {
  /** 通過した下書きを 1 件作り、検証の保留にする */
  async function heldDraft(root: string) {
    await runMain(root, ["plan", EXAM]);
    await runMain(root, ["draft", EXAM]);
    const request = readChoiceRequests(root)[0] as DraftRequest;
    writeOutput(root, request, [draftFor(request)]);
    await runMain(root, ["draft", EXAM, "--import"]);
    const path = workPath(root, "drafts.json");
    const file = readDrafts(path, EXAM);
    const target = file.drafts.find((d) => d.status === "passed") as DraftRecord;
    writeDrafts(path, {
      ...file,
      drafts: file.drafts.map((d) =>
        d.id === target.id
          ? {
              ...d,
              status: "held",
              reasons: ["verify:answer-mismatch"],
              verification: {
                verdict: "hold",
                reasons: ["verify:answer-mismatch"],
                findings: [{ code: "answer-mismatch", where: "choices.B" }],
                checks: {},
              },
            }
          : d,
      ),
    });
    return target.id;
  }

  const reviseRequests = (root: string) => readRequests(root).filter((r) => r.revise !== undefined);
  const revisedText = "Widget Store で、1 つのアカウントがリージョンごとに作れるバケットは、最大でいくつですか。";

  it("保留の下書き_元の本文・保留の理由・検証の指摘・根拠の節の場所・事実カードを載せた直しの依頼を 1 件書く", async () => {
    const root = setupDraftRoot();
    const id = await heldDraft(root);
    const r = await runMain(root, ["draft", EXAM, "--revise"]);
    expect(r.code, r.err).toBe(EXIT.ok);
    const [request] = reviseRequests(root);
    expect(request?.revise?.draftId).toBe(id);
    expect(request?.count).toBe(1);
    expect(request?.revise?.reasons).toEqual(["verify:answer-mismatch"]);
    expect(request?.revise?.findings).toEqual([{ code: "answer-mismatch", where: "choices.B" }]);
    expect(request?.revise?.sections.map((s) => s.heading)).toEqual(["quotas"]);
    expect(request?.facts[0]?.id).toBe(request?.revise?.draft.factIds[0]);
    const original = request?.revise?.draft;
    expect(request?.answerPositions).toEqual([
      original !== undefined && "correctAnswers" in original ? original.correctAnswers : [],
    ]);
    expect(request?.agent?.role).toBe("question-reviser");
    expect(r.out).toContain("直しの依頼:");
    // 同じ入力は、依頼済みとして再び書かない
    const again = await runMain(root, ["draft", EXAM, "--revise"]);
    expect(again.out).toContain("直しの依頼 0 件、依頼済みで待っている 1 件");
  });

  it("直した下書きを取り込む_新しい下書きに直す前の ID を残し、直す前の下書きを不採用(revised)にして本文と来歴を外す", async () => {
    const root = setupDraftRoot();
    const id = await heldDraft(root);
    await runMain(root, ["draft", EXAM, "--revise"]);
    const request = reviseRequests(root)[0] as DraftRequest;
    writeOutput(root, request, [draftFor(request, { questionText: revisedText })]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.code, r.err).toBe(EXIT.ok);
    const drafts = readDrafts(workPath(root, "drafts.json"), EXAM).drafts;
    const before = drafts.find((d) => d.id === id) as DraftRecord;
    const after = drafts.find((d) => d.revisionOf === id) as DraftRecord;
    expect(after.status).toBe("passed");
    expect(after.agent?.role).toBe("question-reviser");
    expect(before.status).toBe("rejected");
    expect(before.reasons).toEqual([REVISED]);
    expect(before.draft).toBeNull();
    expect(before.factIds).toEqual(request.revise?.draft.factIds);
    const provenance = readProvenance(provenancePath(join(root, baseConfig.provenanceDir), EXAM), EXAM);
    expect(provenance.entries.some((e) => e.draftId === id)).toBe(false);
    expect(provenance.entries.some((e) => e.draftId === after.id)).toBe(true);
    expect(r.out).toContain(`直しの取り込み: ${id} → ${after.id}`);
  });

  it("設問文と根拠を変えない直し_同じ ID なので、直す前の記録を直した内容で置き換え、検証の結果を外す", async () => {
    const root = setupDraftRoot();
    const id = await heldDraft(root);
    await runMain(root, ["draft", EXAM, "--revise"]);
    const request = reviseRequests(root)[0] as DraftRequest;
    const original = request.revise?.draft as ReturnType<typeof choiceDraft>;
    const explanation = `${original.explanation}根拠の主張のとおりです。`;
    writeOutput(root, request, [{ ...original, explanation }]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain(`直しの取り込み: ${id}(同じ ID で置き換え)`);
    const drafts = readDrafts(workPath(root, "drafts.json"), EXAM).drafts.filter((d) => d.id === id);
    expect(drafts).toHaveLength(1);
    const replaced = drafts[0] as DraftRecord;
    expect(replaced.status).toBe("passed");
    expect(replaced.draft?.explanation).toBe(explanation);
    expect(replaced.verification).toBeUndefined();
    expect(replaced.revisionOf).toBeUndefined();
    expect(replaced.agent?.role).toBe("question-reviser");
  });

  it("直した下書きが不採用_直す前の下書きは保留のまま残る", async () => {
    const root = setupDraftRoot();
    const id = await heldDraft(root);
    await runMain(root, ["draft", EXAM, "--revise"]);
    const request = reviseRequests(root)[0] as DraftRequest;
    writeOutput(root, request, [draftFor(request, { questionText: revisedText, factIds: ["f-ffffffffffff"] })]);
    await runMain(root, ["draft", EXAM, "--import"]);
    const drafts = readDrafts(workPath(root, "drafts.json"), EXAM).drafts;
    expect(drafts.find((d) => d.id === id)?.status).toBe("held");
    expect(drafts.some((d) => d.revisionOf === id && d.status !== "rejected")).toBe(false);
  });

  it("依頼のあとに人が直す前の下書きを判断した_取り込まず、依頼を捨てる", async () => {
    const root = setupDraftRoot();
    const id = await heldDraft(root);
    await runMain(root, ["draft", EXAM, "--revise"]);
    const request = reviseRequests(root)[0] as DraftRequest;
    writeOutput(root, request, [draftFor(request, { questionText: revisedText })]);
    writeDecisions(decisionsPath(join(root, baseConfig.decisionsDir), EXAM), {
      examCode: EXAM,
      decisions: [{ target: "draft", id, decision: "approve", reason: "reviewed" }],
    });
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.err).toContain("request-stale");
    const drafts = readDrafts(workPath(root, "drafts.json"), EXAM).drafts;
    expect(drafts.some((d) => d.revisionOf === id)).toBe(false);
    expect(reviseRequests(root)).toEqual([]);
  });

  it("保留の下書きがない_直しの依頼を書かない", async () => {
    const root = setupDraftRoot();
    await runMain(root, ["plan", EXAM]);
    const r = await runMain(root, ["draft", EXAM, "--revise"]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain("直しの依頼 0 件");
    expect(reviseRequests(root)).toEqual([]);
  });
});

describe("却下した下書きの根拠と補充の依頼", () => {
  it("人が却下した下書きの根拠のカード_補充の依頼で、使われていないカードより後ろに回す", async () => {
    const others = [2, 3, 4].map((n) =>
      card({ id: `f-${String(n).repeat(12)}`, domain: `domain${n}`, claim: `架空の主張 ${n}` }),
    );
    const root = setupDraftRoot({
      cards: [
        card({ id: "f-aaaaaaaaaaa1", domain: "domain1", claim: "架空の主張 1a" }),
        card({ id: "f-aaaaaaaaaaa2", domain: "domain1", claim: "架空の主張 1b" }),
        ...others,
      ],
    });
    const overrides = { draft: { ...baseConfig.draft, maxFactsPerRequest: 1 } };
    await runMain(root, ["plan", EXAM], overrides);
    await runMain(root, ["draft", EXAM], overrides);
    // 計画の分野 1 の最初の選択式の項目の依頼(同じ実行のあとの依頼は、使った数を足してから選ぶので比べない)
    const first = readPlan(planPath(join(root, baseConfig.workDir), EXAM))?.items.find(
      (i) => i.domain === "domain1" && i.kind !== "free-text",
    );
    const request = readChoiceRequests(root).find((r) => r.planItemId === first?.id) as DraftRequest;
    expect(request.facts.map((f) => f.id)).toEqual(["f-aaaaaaaaaaa1"]);
    writeOutput(root, request, [draftFor(request)]);
    await runMain(root, ["draft", EXAM, "--import"], overrides);
    const id = readDrafts(workPath(root, "drafts.json"), EXAM).drafts.find((d) => d.planItemId === request.planItemId)
      ?.id as string;
    writeDecisions(decisionsPath(join(root, baseConfig.decisionsDir), EXAM), {
      examCode: EXAM,
      decisions: [{ target: "draft", id, decision: "reject", reason: "wrong-answer" }],
    });
    await runMain(root, ["draft", EXAM], overrides);
    const redo = readRequests(root).find((r) => r.planItemId === request.planItemId && r.revise === undefined);
    expect(redo?.facts.map((f) => f.id)).toEqual(["f-aaaaaaaaaaa2"]);
  });
});

describe("理由の集計と直し", () => {
  it("直した下書きに置き換わった下書き(revised)_理由の集計に入れない", async () => {
    const { aggregate } = await import("../reasons/aggregate.ts");
    const drafts: DraftsFile = {
      examCode: EXAM,
      drafts: [
        record({ id: "d-000000000001", status: "rejected", reasons: [REVISED], draft: null }),
        record({ id: "d-000000000002", status: "rejected", reasons: ["long-copy"], draft: null }),
      ],
    };
    const summary = aggregate(EXAM, { examCode: EXAM, extracted: [], cards: [] }, drafts, {
      examCode: EXAM,
      decisions: [],
    });
    expect(summary.reasons.map((r) => r.code)).toEqual(["long-copy"]);
  });
});
