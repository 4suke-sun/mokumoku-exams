import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT } from "../exit-codes.ts";
import { DraftRequestSchema } from "./request.ts";
import { readDrafts, readState } from "./store.ts";
import {
  baseConfig,
  choiceDraft,
  draftFor,
  EXAM,
  freeTextDraftFor,
  multipleDraft,
  readChoiceRequests,
  readRequests,
  runMain,
  setupDraftRoot,
  workPath,
  writeOutput,
  writeRaw,
} from "./test-helpers.ts";

/** plan を実行して、draft の依頼まで進める */
async function prepare(root: string, overrides: Record<string, unknown> = {}) {
  expect((await runMain(root, ["plan", EXAM], overrides)).code).toBe(EXIT.ok);
  return runMain(root, ["draft", EXAM], overrides);
}

describe("draft の依頼", () => {
  it("計画と事実カードがある_項目ごとに依頼を書く", async () => {
    const root = setupDraftRoot();
    const r = await prepare(root);
    expect(r.code).toBe(EXIT.ok);
    const requests = readRequests(root);
    expect(requests.length).toBeGreaterThan(0);
    for (const request of requests) {
      expect(DraftRequestSchema.safeParse(request).success).toBe(true);
      expect(["single", "multiple", "free-text"]).toContain(request.kind);
      expect(request.count).toBeLessThanOrEqual(baseConfig.draft.maxPerRequest);
      expect(request.facts.every((f) => f.claim.startsWith("架空の主張"))).toBe(true);
      expect(request.styleRules.length).toBeGreaterThan(0);
    }
    expect(r.out).toContain("下書きの依頼:");
  });

  it("事実カードのない分野_下書きの依頼を作らず失敗する", async () => {
    const root = setupDraftRoot({ cards: [] });
    const r = await prepare(root);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("下書きの誤り: no-facts domain1");
    expect(readRequests(root)).toEqual([]);
  });

  it("通過していない事実カードだけの分野_依頼を作らない", async () => {
    const { card } = await import("../facts/test-helpers.ts");
    const root = setupDraftRoot({
      cards: [1, 2, 3, 4].map((n) =>
        card({ id: `f-${String(n).repeat(12)}`, domain: `domain${n}`, status: n === 1 ? "held" : "passed" }),
      ),
    });
    const r = await prepare(root);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("no-facts domain1");
    expect(readRequests(root).every((q) => q.domain.code !== "domain1")).toBe(true);
  });

  it("出題計画がない_入力の誤り", async () => {
    const root = setupDraftRoot();
    const r = await runMain(root, ["draft", EXAM]);
    expect(r.code).toBe(EXIT.inputError);
  });

  it("依頼の数が maxItemsPerRun を超える_上限で止まり_再実行で続きから進む", async () => {
    const root = setupDraftRoot();
    const r = await prepare(root, { maxItemsPerRun: 2 });
    expect(r.code).toBe(EXIT.checkFailed);
    expect(readRequests(root)).toHaveLength(2);
    expect(r.err).toContain("件数の上限");
    const again = await runMain(root, ["draft", EXAM], { maxItemsPerRun: 2 });
    expect(again.out).toContain("依頼済みで待っている 2 件");
    expect(readRequests(root)).toHaveLength(4);
  });

  it("--dry-run_何も書かない", async () => {
    const root = setupDraftRoot();
    await runMain(root, ["plan", EXAM]);
    const r = await runMain(root, ["draft", EXAM, "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(readRequests(root)).toEqual([]);
    expect(r.out).toContain("書き込みをしない(dry-run)");
  });
});

function existingQuestion() {
  return {
    questionId: "AIB-0001",
    examCode: EXAM,
    domain: "domain1",
    questionType: "single",
    questionText: "架空の既存の設問です。",
    choices: [
      { key: "A", text: "選択肢 A" },
      { key: "B", text: "選択肢 B" },
    ],
    correctAnswers: ["A"],
    explanation: "架空の解説です。",
  };
}

describe("draft の取り込み", () => {
  async function firstRequest(root: string, overrides: Record<string, unknown> = {}) {
    await prepare(root, overrides);
    return readChoiceRequests(root)[0] as ReturnType<typeof readRequests>[number];
  }

  it("正しい出力_通過として取り込み_依頼と出力を片づける", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    writeOutput(root, request, [draftFor(request)]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.ok);
    const drafts = readDrafts(workPath(root, "drafts.json"), EXAM).drafts;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]).toMatchObject({ status: "passed", reasons: [], planItemId: request.planItemId });
    expect(existsSync(join(root, request.outputPath))).toBe(false);
    expect(readRequests(root).some((q) => q.requestKey === request.requestKey)).toBe(false);
    expect(readState(workPath(root, "state.json")).done).toContain(request.requestKey);
  });

  it("取り込んだあとの依頼_同じ入力は再び依頼せず_残りの数だけ依頼する", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    writeOutput(root, request, [draftFor(request)]);
    await runMain(root, ["draft", EXAM, "--import"]);
    const again = await runMain(root, ["draft", EXAM]);
    expect(again.code).toBe(EXIT.ok);
    const keys = readRequests(root).map((q) => q.requestKey);
    // 取り込み済みの鍵は、もう依頼されない
    expect(keys).not.toContain(request.requestKey);
    const sameItem = readRequests(root).find((q) => q.planItemId === request.planItemId);
    if (sameItem) expect(sameItem.count).toBe(request.count - 1);
  });

  it("形に合わない出力_上限まで再試行され_超えたら失敗として記録される", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    for (let i = 0; i < baseConfig.draft.maxAttempts; i++) {
      writeRaw(root, request, JSON.stringify({ unexpected: true }));
      const r = await runMain(root, ["draft", EXAM, "--import"]);
      expect(r.code).toBe(EXIT.checkFailed);
      expect(r.err).toContain("output-invalid");
      expect(existsSync(join(root, request.outputPath))).toBe(false);
    }
    expect(readState(workPath(root, "state.json")).attempts[request.requestKey]).toBe(baseConfig.draft.maxAttempts);
    // 依頼のファイルを消して出し直そうとしても、上限を超えた鍵は依頼されない
    const { rmSync } = await import("node:fs");
    rmSync(workPath(root, "requests", `${request.requestKey}.json`));
    const again = await runMain(root, ["draft", EXAM]);
    expect(again.code).toBe(EXIT.checkFailed);
    expect(again.err).toContain("再試行の上限");
    expect(readRequests(root).some((q) => q.requestKey === request.requestKey)).toBe(false);
  });

  it("データの契約に合わない下書き_schema-invalid で止め_何も取り込まない", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    // 選択肢のキーが A から始まらない(スタイル規則と誤答の検査では止まらず、データの契約で止まる)
    const base = draftFor(request);
    const shift = (key: string) => String.fromCharCode(key.charCodeAt(0) + 1);
    const bad = {
      ...base,
      choices: base.choices.map((c) => ({ ...c, key: shift(c.key) })),
      correctAnswers: base.correctAnswers.map(shift),
      distractors: (base.distractors ?? []).map((d) => ({ ...d, key: shift(d.key) })),
    };
    writeOutput(root, request, [draftFor(request), bad]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("schema-invalid");
    expect(existsSync(workPath(root, "drafts.json"))).toBe(false);
  });

  it("依頼と違う鍵の出力_request-mismatch", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    writeOutput(root, request, [draftFor(request)], { requestKey: "0".repeat(16) });
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.err).toContain("request-mismatch");
  });

  it("依頼の数を超える出力_output-invalid", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    const many = Array.from({ length: request.count + 1 }, (_, i) =>
      draftFor(request, { questionText: `別の設問 ${i} についての上限はどれですか。` }),
    );
    writeOutput(root, request, many);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.err).toContain("output-invalid");
  });

  it("依頼のファイルの鍵が名前と違う_request-invalid", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    writeOutput(root, request, [draftFor(request)]);
    const path = workPath(root, "requests", `${request.requestKey}.json`);
    writeFileSync(path, JSON.stringify({ ...request, requestKey: "0".repeat(16) }));
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain(`${request.requestKey} request-invalid`);
  });

  it("依頼のあとに事実カードが変わった_request-stale で依頼を捨てる", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    writeOutput(root, request, [draftFor(request)]);
    const { card } = await import("../facts/test-helpers.ts");
    const { writeFacts, emptyFacts, factsPath } = await import("../facts/schema.ts");
    writeFacts(factsPath(join(root, baseConfig.factsDir), EXAM), {
      ...emptyFacts(EXAM),
      cards: [card({ id: request.facts[0]?.id ?? "", domain: request.domain.code, claim: "変わった主張" })],
    });
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.err).toContain("request-stale");
    expect(existsSync(workPath(root, "requests", `${request.requestKey}.json`))).toBe(false);
  });

  it("止める規則に違反する下書き_不採用になり_本文を保存せず_報告にも出さない", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    const leaky = draftFor(request, {
      questionText: "https://example.com/secret-looking-path を読んで、正しいものを 2 つ選択してください。",
    });
    writeOutput(root, request, [leaky]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("下書きの不採用:");
    expect(r.out).toContain("no-url questionText");
    expect(r.err + r.out).not.toContain("secret-looking-path");
    const drafts = readDrafts(workPath(root, "drafts.json"), EXAM).drafts;
    expect(drafts[0]).toMatchObject({ status: "rejected", draft: null, reasons: ["style:no-url"] });
    expect(readFileSync(workPath(root, "drafts.json"), "utf8")).not.toContain("secret-looking-path");
  });

  it("警告の規則だけに違反する下書き_通過し_警告として報告される", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    const warned = draftFor(request, {
      questionText:
        request.kind === "multiple" ? "誤っている説明を 2 つ選択してください。" : "誤っているものはどれですか。",
    });
    writeOutput(root, request, [warned]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("下書きの警告:");
    const drafts = readDrafts(workPath(root, "drafts.json"), EXAM).drafts;
    expect(drafts[0]?.status).toBe("passed");
    expect(drafts[0]?.warnings.map((w) => w.rule)).toContain("stem-negation");
  });

  it("依頼にない事実カードを根拠にした下書き_不採用", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    writeOutput(root, request, [draftFor(request, { factIds: ["f-ffffffffffff"] })]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("fact-not-in-request");
    expect(readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0]?.status).toBe("rejected");
  });

  it("依頼の種別と違う下書き_不採用", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    const other = request.kind === "single" ? "multiple" : "single";
    writeOutput(root, request, [draftFor(request, { questionType: other })]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("kind-mismatch");
  });

  it("全件が不採用_出し直しの依頼が出て_回数の上限で止まる", async () => {
    const root = setupDraftRoot();
    let request = await firstRequest(root);
    const seen = new Set<string>();
    for (let round = 0; round < baseConfig.draft.maxRounds; round++) {
      expect(seen.has(request.requestKey)).toBe(false);
      seen.add(request.requestKey);
      writeOutput(root, request, [draftFor(request, { questionText: `上限は ${round} 個です。` })]);
      await runMain(root, ["draft", EXAM, "--import"]);
      const next = await runMain(root, ["draft", EXAM]);
      const same = readRequests(root).find((q) => q.planItemId === request.planItemId);
      if (round < baseConfig.draft.maxRounds - 1) {
        expect(same).toBeDefined();
        request = same as typeof request;
      } else {
        expect(same).toBeUndefined();
        expect(next.err).toContain("再試行の上限");
      }
    }
  });

  it("実行しても_data の問題データは変わらない", async () => {
    const questions = { examCode: EXAM, questions: [existingQuestion()] };
    const root = setupDraftRoot({ questions });
    const file = join(root, "data/questions.aws-aib-c01.json");
    const before = readFileSync(file, "utf8");
    const request = await firstRequest(root);
    writeOutput(root, request, [draftFor(request)]);
    await runMain(root, ["draft", EXAM, "--import"]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });

  it("同じ設問の下書きを再び取り込む_重ねて記録しない", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    const d = choiceDraft({ factIds: [request.facts[0]?.id ?? ""] });
    writeOutput(root, request, [
      request.kind === "multiple" ? draftFor(request) : d,
      request.kind === "multiple" ? draftFor(request) : d,
    ]);
    await runMain(root, ["draft", EXAM, "--import"]);
    expect(readDrafts(workPath(root, "drafts.json"), EXAM).drafts).toHaveLength(1);
  });
});

describe("draft の来歴", () => {
  const provenanceFile = (root: string) => join(root, baseConfig.provenanceDir, "aws-aib-c01.json");

  async function imported(root: string) {
    await prepare(root);
    const request = readChoiceRequests(root)[0] as ReturnType<typeof readRequests>[number];
    writeOutput(root, request, [draftFor(request)]);
    await runMain(root, ["draft", EXAM, "--import"]);
    return request;
  }

  it("取り込んだ下書き_根拠の事実カードと出典を結ぶ来歴が記録され_本文を含まない", async () => {
    const root = setupDraftRoot();
    const request = await imported(root);
    const record = readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0];
    const text = readFileSync(provenanceFile(root), "utf8");
    const file = JSON.parse(text) as { entries: { draftId: string; factIds: string[]; sources: { url: string }[] }[] };
    expect(file.entries).toHaveLength(1);
    expect(file.entries[0]).toMatchObject({ draftId: record?.id, factIds: [request.facts[0]?.id] });
    expect(file.entries[0]?.sources[0]?.url).toMatch(/^https:\/\//);
    expect(text).not.toContain(record?.draft?.questionText ?? "あり得ない");
  });

  it("不採用の下書き_来歴を記録しない", async () => {
    const root = setupDraftRoot();
    await prepare(root);
    const request = readChoiceRequests(root)[0] as ReturnType<typeof readRequests>[number];
    writeOutput(root, request, [
      draftFor(request, { questionText: "https://example.com/x を読んで、2 つ選択してください。" }),
    ]);
    await runMain(root, ["draft", EXAM, "--import"]);
    expect(existsSync(provenanceFile(root))).toBe(false);
  });

  it("出典が台帳にない_来歴を作れず不採用になる", async () => {
    const root = setupDraftRoot();
    const { emptyLedger, ledgerPath, writeLedger } = await import("../collect/ledger.ts");
    writeLedger(ledgerPath(join(root, baseConfig.ledgerDir), EXAM), emptyLedger(EXAM));
    await prepare(root);
    const request = readChoiceRequests(root)[0] as ReturnType<typeof readRequests>[number];
    writeOutput(root, request, [draftFor(request)]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("provenance:source-not-in-ledger");
    expect(readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0]?.status).toBe("rejected");
    expect(existsSync(provenanceFile(root))).toBe(false);
  });

  it("--check_来歴のある下書きだけなら通る", async () => {
    const root = setupDraftRoot();
    await imported(root);
    const r = await runMain(root, ["draft", EXAM, "--check"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("来歴のある通過済みの下書き 1 件");
  });

  it("--check_来歴のない下書きは先へ進めず失敗として報告される", async () => {
    const root = setupDraftRoot();
    await imported(root);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(provenanceFile(root), `${JSON.stringify({ examCode: EXAM, entries: [] })}\n`);
    const r = await runMain(root, ["draft", EXAM, "--check"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("来歴なし: d-");
  });

  it("--check_存在しない事実カードを指す来歴は失敗する", async () => {
    const root = setupDraftRoot();
    await imported(root);
    const { emptyFacts, factsPath, writeFacts } = await import("../facts/schema.ts");
    writeFacts(factsPath(join(root, baseConfig.factsDir), EXAM), emptyFacts(EXAM));
    const r = await runMain(root, ["draft", EXAM, "--check"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("fact-not-found");
  });

  it("--check_許可していないドメインの出典は失敗する", async () => {
    const root = setupDraftRoot();
    await imported(root);
    const { writeFileSync } = await import("node:fs");
    const file = JSON.parse(readFileSync(provenanceFile(root), "utf8"));
    file.entries[0].sources[0].url = "https://example.com/doc";
    writeFileSync(provenanceFile(root), JSON.stringify(file));
    const r = await runMain(root, ["draft", EXAM, "--check"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("source-url-host-not-allowed");
  });

  it("--check_壊れた来歴ファイルは失敗し_値を出さない", async () => {
    const root = setupDraftRoot();
    await imported(root);
    const { writeFileSync } = await import("node:fs");
    writeFileSync(
      provenanceFile(root),
      JSON.stringify({ examCode: EXAM, entries: [{ draftId: "secret-looking-id" }] }),
    );
    const r = await runMain(root, ["draft", EXAM, "--check"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("来歴の誤り");
    expect(r.err).not.toContain("secret-looking-id");
  });
});

describe("draft の誤答の検査", () => {
  async function requestOf(root: string) {
    await prepare(root);
    return readChoiceRequests(root)[0] as ReturnType<typeof readRequests>[number];
  }

  it("誤答の設計がない下書き_不採用になり_誤答の理由コードで報告される", async () => {
    const root = setupDraftRoot();
    const request = await requestOf(root);
    writeOutput(root, request, [draftFor(request, { distractors: undefined })]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("distractor-missing");
    const record = readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0];
    expect(record?.status).toBe("rejected");
    expect(record?.reasons).toEqual(["distractor:distractor-missing"]);
    expect(record?.draft).toBeNull();
  });

  it("誤答の型が偏る下書き_通過し_警告として報告される", async () => {
    const root = setupDraftRoot();
    const request = await requestOf(root);
    const base = draftFor(request);
    const same = (base.distractors ?? []).map((d) => ({ ...d, type: "misconception" as const }));
    writeOutput(root, request, [{ ...base, distractors: same }]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("distractor-type-bias distractors");
    expect(readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0]?.status).toBe("passed");
  });

  it("正答が複数になりうる誤答_保留になり_本文は残り_計画の数に数える", async () => {
    const root = setupDraftRoot();
    const request = await requestOf(root);
    const base = draftFor(request);
    // 正答と、ほぼ同じ文言の選択肢を誤答に混ぜる(短すぎる文は類似度で比べないので、十分な長さにする)
    const correctKey = base.correctAnswers[0];
    const long = "リージョンごとに数えられる上限として、アカウントに定められている数";
    const tweaked = base.choices.map((c, i) => {
      if (c.key === correctKey) return { ...c, text: long };
      if (i === base.choices.length - 1) return { ...c, text: `${long}です` };
      return c;
    });
    writeOutput(root, request, [{ ...base, choices: tweaked }]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("下書きの保留:");
    expect(r.out).toContain("ambiguous:similar-to-correct");
    const record = readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0];
    expect(record?.status).toBe("held");
    expect(record?.draft).not.toBeNull();
    // 保留の下書きは、次の依頼の数に数える(出し直しの依頼にはならない)
    const again = await runMain(root, ["draft", EXAM]);
    expect(again.code).toBe(EXIT.ok);
    const same = readRequests(root).find((q) => q.planItemId === request.planItemId);
    if (same) expect(same.count).toBe(request.count - 1);
  });
});

describe("draft の重複の検出", () => {
  function published(stems: string[]) {
    const q = (n: number, stem: string, type: "single" | "multiple") => ({
      questionId: `AIB-${String(n).padStart(4, "0")}`,
      examCode: EXAM,
      domain: "domain1",
      questionType: type,
      questionText: stem,
      choices: [
        { key: "A", text: `既存の選択肢 ${n} A` },
        { key: "B", text: `既存の選択肢 ${n} B` },
        { key: "C", text: `既存の選択肢 ${n} C` },
      ],
      correctAnswers: type === "single" ? ["A"] : ["A", "B"],
      explanation: "架空の解説です。",
    });
    return { examCode: EXAM, questions: stems.map((stem, i) => q(i + 1, stem, i % 2 === 0 ? "single" : "multiple")) };
  }

  async function firstRequest(root: string) {
    await prepare(root);
    return readChoiceRequests(root)[0] as ReturnType<typeof readRequests>[number];
  }

  it("公開済みの問題とほぼ同じ設問文_重複として落とし_相手の識別子と類似度だけを報告する", async () => {
    const root = setupDraftRoot({
      questions: published([choiceDraft().questionText, multipleDraft().questionText]),
    });
    const request = await firstRequest(root);
    writeOutput(root, request, [draftFor(request)]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toMatch(/下書きの不採用: d-[0-9a-f]{12} duplicate-similar AIB-000[12] 1\.00/);
    expect(r.out + r.err).not.toContain("Widget Store");
    const record = readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0];
    expect(record).toMatchObject({ status: "rejected", draft: null });
    expect(record?.reasons.some((x) => x.startsWith("duplicate:similar-existing"))).toBe(true);
  });

  it("無関係な下書き_検出されない", async () => {
    const root = setupDraftRoot({ questions: published(["ログの保管期間を延ばすには、どの設定を変更しますか。"]) });
    const request = await firstRequest(root);
    writeOutput(root, request, [draftFor(request)]);
    await runMain(root, ["draft", EXAM, "--import"]);
    expect(readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0]?.status).toBe("passed");
  });

  it("同じ取り込みの中の下書き同士_あとの下書きが重複として落ちる", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    const first = draftFor(request);
    const second = { ...first, questionText: `なお、${first.questionText}` };
    writeOutput(root, request, [first, second]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("duplicate-similar d-");
    const statuses = readDrafts(workPath(root, "drafts.json"), EXAM)
      .drafts.map((d) => d.status)
      .sort();
    expect(statuses).toEqual(["passed", "rejected"]);
  });

  it("設問文が似ていて同じ事実カードを根拠にする下書き_保留になり_先へ進めない", async () => {
    const root = setupDraftRoot();
    const request = await firstRequest(root);
    const first = draftFor(request);
    const second = {
      ...first,
      questionText: "Widget Store のアカウントごとの上限について、正しい説明を 2 つ選択してください。",
    };
    writeOutput(root, request, [first, second]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("下書きの保留:");
    expect(r.out).toMatch(/review-(topic|similar)/);
    const drafts = readDrafts(workPath(root, "drafts.json"), EXAM).drafts;
    expect(drafts.map((d) => d.status).sort()).toEqual(["held", "passed"]);
    const held = drafts.find((d) => d.status === "held");
    expect(held?.reasons[0]).toMatch(/^review:(topic|similar)-draft$/);
    // 保留の下書きは、来歴の検査の対象でもあり、来歴を持つ
    expect((await runMain(root, ["draft", EXAM, "--check"])).code).toBe(EXIT.ok);
  });

  it("捨てられた出力の下書き_後の出力の重複の比較の相手に残らない", async () => {
    const root = setupDraftRoot();
    await prepare(root);
    // 同じ種別の依頼を 2 つ取る(取り込みは、依頼の鍵の順に処理する)
    const requests = readChoiceRequests(root);
    const first = requests[0] as ReturnType<typeof readRequests>[number];
    const second = requests.find((q) => q !== first && q.kind === first.kind) as typeof first;
    const base = draftFor(first);
    // 1 つ目の出力は、通る下書きと、データの契約に合わない下書きを含み、全体が捨てられる
    const shift = (key: string) => String.fromCharCode(key.charCodeAt(0) + 1);
    const bad = {
      ...base,
      questionText: `別の設問として、${base.questionText}`,
      choices: base.choices.map((c) => ({ ...c, key: shift(c.key) })),
      correctAnswers: base.correctAnswers.map(shift),
      distractors: (base.distractors ?? []).map((d) => ({ ...d, key: shift(d.key) })),
    };
    writeOutput(root, first, [base, bad]);
    // 2 つ目の出力は、捨てられる下書きとほぼ同じ設問文
    writeOutput(root, second, [draftFor(second, { questionText: base.questionText })]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.err).toContain("schema-invalid");
    expect(r.out).not.toContain("duplicate-similar");
    const drafts = readDrafts(workPath(root, "drafts.json"), EXAM).drafts;
    expect(drafts).toHaveLength(1);
    expect(drafts[0]?.status).toBe("passed");
  });

  it("問題データの形が違う_取り込みを止め_本文を出さない", async () => {
    const root = setupDraftRoot({
      questions: { examCode: EXAM, questions: [{ questionText: "secret-looking-stem" }] },
    });
    await runMain(root, ["plan", EXAM]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("問題データの誤り");
    expect(r.err + r.out).not.toContain("secret-looking-stem");
  });

  it("実行しても_data の問題データは変わらない", async () => {
    const root = setupDraftRoot({ questions: published([choiceDraft().questionText]) });
    const file = join(root, "data/questions.aws-aib-c01.json");
    const before = readFileSync(file, "utf8");
    const request = await firstRequest(root);
    writeOutput(root, request, [draftFor(request)]);
    await runMain(root, ["draft", EXAM, "--import"]);
    expect(readFileSync(file, "utf8")).toBe(before);
  });
});

describe("draft の自由記述", () => {
  async function freeTextRequest(root: string) {
    await prepare(root, { plan: { ...baseConfig.plan, typeMix: { single: 0, multiple: 0, "free-text": 1 } } });
    return readRequests(root)[0] as ReturnType<typeof readRequests>[number];
  }

  it("種別が自由記述の計画_自由記述の依頼を書く", async () => {
    const root = setupDraftRoot();
    const request = await freeTextRequest(root);
    expect(request.kind).toBe("free-text");
    expect(readRequests(root).every((q) => q.kind === "free-text")).toBe(true);
    // 採点基準の規則は載るが、選択肢の規則は載らない
    const names = request.styleRules.map((r) => r.name);
    expect(names).toContain("rubric-pass-ratio");
    expect(names).not.toContain("choice-count");
  });

  it("正しい自由記述の下書き_通過し_来歴が記録される", async () => {
    const root = setupDraftRoot();
    const request = await freeTextRequest(root);
    writeOutput(root, request, [freeTextDraftFor(request)]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.ok);
    const record = readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0];
    expect(record).toMatchObject({ status: "passed", reasons: [] });
    expect(record?.draft?.questionType).toBe("free-text");
    expect((await runMain(root, ["draft", EXAM, "--check"])).code).toBe(EXIT.ok);
  });

  it("合格点が配点の合計を超える採点基準_schema-invalid で止まる", async () => {
    const root = setupDraftRoot();
    const request = await freeTextRequest(root);
    const ok = freeTextDraftFor(request);
    writeOutput(root, request, [{ ...ok, rubric: { ...ok.rubric, passingPoints: 101 } }]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("schema-invalid");
    expect(existsSync(workPath(root, "drafts.json"))).toBe(false);
  });

  it("観点名が重複する採点基準_schema-invalid で止まる", async () => {
    const root = setupDraftRoot();
    const request = await freeTextRequest(root);
    const ok = freeTextDraftFor(request);
    const first = ok.rubric.criteria[0] as (typeof ok.rubric.criteria)[number];
    writeOutput(root, request, [
      { ...ok, rubric: { ...ok.rubric, criteria: [first, { ...first, keywords: ["別の語"] }] } },
    ]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.err).toContain("schema-invalid");
  });

  it("キーワードが空になる採点基準_schema-invalid で止まる", async () => {
    const root = setupDraftRoot();
    const request = await freeTextRequest(root);
    const ok = freeTextDraftFor(request);
    const [first, second] = ok.rubric.criteria as [
      (typeof ok.rubric.criteria)[number],
      (typeof ok.rubric.criteria)[number],
    ];
    writeOutput(root, request, [
      { ...ok, rubric: { ...ok.rubric, criteria: [{ ...first, keywords: ["  "] }, second] } },
    ]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.checkFailed);
  });

  it("根拠の事実カードが依頼にない自由記述_不採用になり_来歴も作らない", async () => {
    const root = setupDraftRoot();
    const request = await freeTextRequest(root);
    writeOutput(root, request, [freeTextDraftFor(request, { factIds: ["f-ffffffffffff"] })]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("fact-not-in-request");
    expect(readDrafts(workPath(root, "drafts.json"), EXAM).drafts[0]?.status).toBe("rejected");
  });

  it("選択式の依頼に自由記述を返す_kind-mismatch で不採用", async () => {
    const root = setupDraftRoot();
    await prepare(root);
    const request = readChoiceRequests(root)[0] as ReturnType<typeof readRequests>[number];
    writeOutput(root, request, [freeTextDraftFor(request)]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("kind-mismatch");
  });

  it("来歴のない自由記述の下書き_--check で先へ進めない", async () => {
    const root = setupDraftRoot();
    const request = await freeTextRequest(root);
    writeOutput(root, request, [freeTextDraftFor(request)]);
    await runMain(root, ["draft", EXAM, "--import"]);
    writeFileSync(
      join(root, baseConfig.provenanceDir, "aws-aib-c01.json"),
      `${JSON.stringify({ examCode: EXAM, entries: [] })}\n`,
    );
    const r = await runMain(root, ["draft", EXAM, "--check"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("来歴なし: d-");
  });

  it("自由記述の本文_不採用の場合は保存しない", async () => {
    const root = setupDraftRoot();
    const request = await freeTextRequest(root);
    writeOutput(root, request, [
      freeTextDraftFor(request, { questionText: "https://example.com/secret-looking-path を説明してください。" }),
    ]);
    const r = await runMain(root, ["draft", EXAM, "--import"]);
    expect(r.out).toContain("no-url questionText");
    expect(r.out + r.err).not.toContain("secret-looking-path");
    expect(readFileSync(workPath(root, "drafts.json"), "utf8")).not.toContain("secret-looking-path");
  });
});
