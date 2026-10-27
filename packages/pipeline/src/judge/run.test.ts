import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyLedger, ledgerPath, writeLedger } from "../collect/ledger.ts";
import { baseConfig, runMain } from "../draft/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { DOC_HASH, DOC_URL } from "../facts/test-helpers.ts";
import { type JudgeResults, JudgeResultsSchema } from "./schema.ts";
import {
  EXAM,
  goodQuestion,
  JUDGE_DIR,
  readJudgeRequests,
  setupJudgeRoot,
  weakQuestion,
  writeJudgeOutput,
  writeQuestions,
} from "./test-helpers.ts";

const results = (root: string): JudgeResults =>
  JudgeResultsSchema.parse(JSON.parse(readFileSync(join(root, JUDGE_DIR, "results.json"), "utf8")));

describe("judge の依頼", () => {
  it("公開している選択式の問題_1 問ごとに依頼を書き_判定の基準と機械の観点を載せ_出典の節は載せない", async () => {
    const root = setupJudgeRoot([goodQuestion(1), weakQuestion(2)]);
    const r = await runMain(root, ["judge", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    const requests = readJudgeRequests(root);
    expect(requests.map((q) => q.questionId).sort()).toEqual(["AIB-0001", "AIB-0002"]);
    const good = requests.find((q) => q.questionId === "AIB-0001");
    const weak = requests.find((q) => q.questionId === "AIB-0002");
    expect(good?.machine).toEqual({ total: 100, lost: [], candidate: false });
    expect(weak?.machine.candidate).toBe(true);
    expect(weak?.machine.total).toBeLessThan(80);
    expect(good?.criteria.path).toBe("docs/exam-style/aws-aib.md");
    expect(good?.criteria.text).toContain("## 6. 判定の基準");
    expect(good?.locations).toEqual([
      "questionText",
      "explanation",
      "choices.A",
      "choices.B",
      "choices.C",
      "choices.D",
    ]);
    expect(Object.keys(good ?? {})).not.toContain("sections");
    expect(good?.agent.role).toBe("question-judge");
    expect(r.out).toContain("依頼 2 件");
  });

  it("台帳に試験ガイドの一覧がある_依頼の判定の基準の末尾に載せ_一覧が変わると判定をやり直す", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    const path = ledgerPath(join(root, baseConfig.ledgerDir), EXAM);
    const guide = (excludedServices: string[]) => ({
      sourceUrl: DOC_URL,
      contentHash: DOC_HASH,
      pages: [],
      importedAt: "2026-10-25",
      services: ["AWS Lambda"],
      excludedServices,
      domains: [{ code: "domain1", name: "a", weight: 1, scope: [] }],
    });
    writeLedger(path, { ...emptyLedger(EXAM), guide: guide(["Amazon Kinesis"]) });
    await runMain(root, ["judge", EXAM]);
    const first = readJudgeRequests(root)[0];
    expect(first?.criteria.text).toContain("対象のサービス: AWS Lambda");
    expect(first?.criteria.text).toContain("対象外のサービス: Amazon Kinesis");
    writeLedger(path, { ...emptyLedger(EXAM), guide: guide(["Amazon Kinesis", "Amazon SageMaker"]) });
    await runMain(root, ["judge", EXAM]);
    const keys = readJudgeRequests(root).map((q) => q.criteriaHash);
    expect(new Set(keys).size).toBe(2);
  });

  it("台帳が壊れている_台帳の誤りとして止まる", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    const path = ledgerPath(join(root, baseConfig.ledgerDir), EXAM);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{壊れた JSON");
    const r = await runMain(root, ["judge", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("台帳の誤り");
  });

  it("自由記述の問題_判定しない", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    const file = join(root, "data/questions.aws-aib-c01.json");
    const data = JSON.parse(readFileSync(file, "utf8"));
    data.questions.push({
      questionId: "AIB-0009",
      examCode: EXAM,
      domain: "domain1",
      questionType: "free-text",
      questionText: "導入の進め方を説明してください。",
      explanation: "解答の例。",
      rubric: { criteria: [{ name: "進め方", keywords: ["方針"], points: 10 }], passingPoints: 10 },
    });
    writeFileSync(file, JSON.stringify(data));
    await runMain(root, ["judge", EXAM]);
    expect(readJudgeRequests(root).map((q) => q.questionId)).toEqual(["AIB-0001"]);
  });

  it("同じ入力で 2 回実行_2 回目は依頼を増やさず_待っている件数に数える", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    await runMain(root, ["judge", EXAM]);
    const r = await runMain(root, ["judge", EXAM]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("依頼 0 件、依頼済みで待っている 1 件");
    expect(readJudgeRequests(root)).toHaveLength(1);
  });

  it("件数の上限_上限までで止まり_検査の失敗として終わる。再実行で続きから進む", async () => {
    const root = setupJudgeRoot([goodQuestion(1), goodQuestion(2), goodQuestion(3)]);
    const first = await runMain(root, ["judge", EXAM], { maxItemsPerRun: 2 });
    expect(first.code).toBe(EXIT.checkFailed);
    expect(readJudgeRequests(root)).toHaveLength(2);
    expect(first.err).toContain("件数の上限");
    const second = await runMain(root, ["judge", EXAM], { maxItemsPerRun: 2 });
    expect(second.code).toBe(EXIT.ok);
    expect(readJudgeRequests(root)).toHaveLength(3);
  });

  it("dry-run_何も書かない", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    const r = await runMain(root, ["judge", EXAM, "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(existsSync(join(root, JUDGE_DIR))).toBe(false);
  });

  it("判定の基準の節がない_入力の誤りとして止まる", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    writeFileSync(join(root, "docs/exam-style/aws-aib.md"), "# AIB\n\n## 1. 要点\n\n本文\n");
    const r = await runMain(root, ["judge", EXAM]);
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("判定の基準がない");
  });

  it("問題データがない・点数票の帯がない資格_入力の誤りとして止まる", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    expect((await runMain(root, ["judge", "AWS-CLF-C02"])).code).toBe(EXIT.inputError);
    expect((await runMain(root, ["judge", "EX-SMP-XX"])).code).toBe(EXIT.inputError);
    expect((await runMain(root, ["judge"])).code).toBe(EXIT.inputError);
  });
});

describe("judge の取り込み", () => {
  it("判定役の出力_依頼と照合して取り込み_結果に判定・理由コード・機械の点数を残し_本文は残さない", async () => {
    const q = [goodQuestion(1), weakQuestion(2), goodQuestion(3)];
    const root = setupJudgeRoot(q);
    await runMain(root, ["judge", EXAM]);
    const requests = readJudgeRequests(root);
    const byId = (id: string) => requests.find((x) => x.questionId === id) as (typeof requests)[number];
    writeJudgeOutput(root, byId("AIB-0001"), { verdict: "publish", findings: [] });
    writeJudgeOutput(root, byId("AIB-0002"), {
      verdict: "rewritable",
      findings: [
        { code: "type-mismatch", where: "questionText" },
        { code: "choices-weak", where: "choices.B" },
        { code: "choices-weak", where: "choices.C" },
      ],
    });
    writeJudgeOutput(root, byId("AIB-0003"), {
      verdict: "unpublish",
      findings: [{ code: "not-unique", where: "questionText" }],
    });
    const r = await runMain(root, ["judge", EXAM, "--import"]);
    expect(r.code, r.err).toBe(EXIT.ok);
    const got = results(root);
    expect(got.entries.map((e) => [e.questionId, e.verdict])).toEqual([
      ["AIB-0001", "publish"],
      ["AIB-0002", "rewritable"],
      ["AIB-0003", "unpublish"],
    ]);
    expect(got.entries[1]?.reasons).toEqual(["judge:choices-weak", "judge:type-mismatch"]);
    expect(got.entries[1]?.machine.total).toBeLessThan(80);
    expect(got.entries[0]?.machine).toEqual({ total: 100, lost: [], candidate: false });
    expect(got.entries[1]?.machine.candidate).toBe(true);
    expect(got.entries[0]?.agent.role).toBe("question-judge");
    const raw = readFileSync(join(root, JUDGE_DIR, "results.json"), "utf8");
    for (const item of q) {
      expect(raw).not.toContain(item.questionText.slice(0, 20));
      expect(raw).not.toContain(item.explanation.slice(0, 12));
    }
    expect(r.out).toContain("判定済み 3 問: publish 1、rewritable 1、unpublish 1");
    expect(r.out).toContain("judge:choices-weak=1");
    expect(r.out).toContain("機械の観点で不合格(候補)の問題 1 問のうち、判定が publish のもの 0 問");
    expect(readJudgeRequests(root)).toHaveLength(0);
    expect(r.out + r.err).not.toContain(q[0]?.questionText.slice(0, 20));
  });

  it("取り込み済みの問題_再び依頼せず_飛ばした件数に数える", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    await runMain(root, ["judge", EXAM]);
    writeJudgeOutput(root, readJudgeRequests(root)[0] as never, { verdict: "publish", findings: [] });
    await runMain(root, ["judge", EXAM, "--import"]);
    const r = await runMain(root, ["judge", EXAM]);
    expect(r.out).toContain("依頼 0 件、依頼済みで待っている 0 件、判定済みで飛ばした 1 件");
  });

  it.each([
    [
      "publish に指摘がある",
      { verdict: "publish", findings: [{ code: "choices-weak", where: "choices.B" }] },
      "publish-with-findings",
    ],
    ["rewritable に指摘がない", { verdict: "rewritable", findings: [] }, "rewritable-needs-finding"],
    [
      "rewritable に書き直せない理由がある",
      { verdict: "rewritable", findings: [{ code: "out-of-scope", where: "questionText" }] },
      "rewritable-with-unpublish-code",
    ],
    [
      "unpublish に書き直せない理由がない",
      { verdict: "unpublish", findings: [{ code: "choices-weak", where: "choices.B" }] },
      "unpublish-needs-unpublish-code",
    ],
    [
      "依頼にない場所",
      { verdict: "rewritable", findings: [{ code: "choices-weak", where: "choices.Z" }] },
      "location-unknown",
    ],
    [
      "形が違う",
      { verdict: "rewritable", findings: [{ code: "choices-weak", where: "choices.B" }], note: "本文" },
      "output-invalid",
    ],
  ])("出力が規則に合わない(%s)_取り込まず_理由を報告し_出力を消して失敗に数える", async (_name, output, reason) => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    await runMain(root, ["judge", EXAM]);
    const request = readJudgeRequests(root)[0] as never;
    writeJudgeOutput(root, request, output);
    const r = await runMain(root, ["judge", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain(`判定の取り込みの停止:`);
    expect(r.err).toContain(reason);
    expect(existsSync(join(root, (request as { outputPath: string }).outputPath))).toBe(false);
    expect(existsSync(join(root, JUDGE_DIR, "results.json"))).toBe(false);
    const state = JSON.parse(readFileSync(join(root, JUDGE_DIR, "state.json"), "utf8")) as Record<string, number>;
    expect(Object.values(state)).toEqual([1]);
  });

  it("別の依頼の識別子の出力_id-mismatch で止める", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    await runMain(root, ["judge", EXAM]);
    const request = readJudgeRequests(root)[0] as never;
    writeJudgeOutput(root, request, { verdict: "publish", findings: [], questionId: "AIB-0099" });
    const r = await runMain(root, ["judge", EXAM, "--import"]);
    expect(r.err).toContain("id-mismatch");
  });

  it("出力がない依頼_取り込まず待つ", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    await runMain(root, ["judge", EXAM]);
    const r = await runMain(root, ["judge", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.err).toContain("判定の出力なし");
    expect(readJudgeRequests(root)).toHaveLength(1);
  });

  it("形が違う出力が上限まで続く_その依頼を出し直さず_検査の失敗として止まる", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    for (let i = 0; i < baseConfig.judge.maxAttempts; i++) {
      await runMain(root, ["judge", EXAM]);
      writeJudgeOutput(root, readJudgeRequests(root)[0] as never, { verdict: "publish", findings: [{ code: "bad" }] });
      await runMain(root, ["judge", EXAM, "--import"]);
    }
    const r = await runMain(root, ["judge", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("再試行の上限");
  });

  it("依頼のあとに判定の基準が変わった_取り込まず依頼を捨て_次の依頼で作り直す", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    await runMain(root, ["judge", EXAM]);
    const request = readJudgeRequests(root)[0] as never;
    writeJudgeOutput(root, request, { verdict: "publish", findings: [] });
    const doc = join(root, "docs/exam-style/aws-aib.md");
    writeFileSync(doc, `${readFileSync(doc, "utf8")}\n- 基準に足した行。\n`);
    const r = await runMain(root, ["judge", EXAM, "--import"]);
    expect(r.err).toContain("request-stale");
    expect(readJudgeRequests(root)).toHaveLength(0);
    expect(existsSync(join(root, JUDGE_DIR, "results.json"))).toBe(false);
    await runMain(root, ["judge", EXAM]);
    expect(readJudgeRequests(root)).toHaveLength(1);
  });

  it("依頼のあとに問題の内容が変わった_取り込まず依頼を捨てる", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    await runMain(root, ["judge", EXAM]);
    writeJudgeOutput(root, readJudgeRequests(root)[0] as never, { verdict: "publish", findings: [] });
    writeQuestions(root, [{ ...goodQuestion(1), explanation: "## 正解の決め手\n解説を書き直しました。" }]);
    const r = await runMain(root, ["judge", EXAM, "--import"]);
    expect(r.err).toContain("request-stale");
    expect(readJudgeRequests(root)).toHaveLength(0);
  });

  it("依頼のあとに判定役の定義が変わった_取り込まず依頼を捨てる", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    await runMain(root, ["judge", EXAM]);
    writeJudgeOutput(root, readJudgeRequests(root)[0] as never, { verdict: "publish", findings: [] });
    const def = join(root, ".claude/agents/question-judge.md");
    writeFileSync(def, `${readFileSync(def, "utf8")}\n- 指示を足した。\n`);
    const r = await runMain(root, ["judge", EXAM, "--import"]);
    expect(r.err).toContain("request-stale");
  });

  it("公開から消えた問題の結果_次の取り込みで残さない", async () => {
    const root = setupJudgeRoot([goodQuestion(1), goodQuestion(2)]);
    await runMain(root, ["judge", EXAM]);
    for (const request of readJudgeRequests(root)) {
      writeJudgeOutput(root, request, { verdict: "publish", findings: [] });
    }
    await runMain(root, ["judge", EXAM, "--import"]);
    expect(results(root).entries).toHaveLength(2);
    writeQuestions(root, [goodQuestion(1)]);
    await runMain(root, ["judge", EXAM, "--import"]);
    expect(results(root).entries.map((e) => e.questionId)).toEqual(["AIB-0001"]);
  });

  it("dry-run_結果を書かず依頼も消さない", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    await runMain(root, ["judge", EXAM]);
    writeJudgeOutput(root, readJudgeRequests(root)[0] as never, { verdict: "publish", findings: [] });
    const r = await runMain(root, ["judge", EXAM, "--import", "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(existsSync(join(root, JUDGE_DIR, "results.json"))).toBe(false);
    expect(readJudgeRequests(root)).toHaveLength(1);
  });

  it("判定役の定義がない_エージェントの定義の誤りとして止まる", async () => {
    const root = setupJudgeRoot([goodQuestion(1)]);
    writeFileSync(join(root, ".claude/agents/question-judge.md"), "定義なし");
    const r = await runMain(root, ["judge", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("エージェントの定義の誤り");
  });
});
