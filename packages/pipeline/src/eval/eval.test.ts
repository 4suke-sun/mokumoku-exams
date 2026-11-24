import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionsPath, writeDecisions } from "../decisions/decisions.ts";
import type { ChoiceDraft } from "../draft/schema.ts";
import { type DraftRecord, writeDrafts } from "../draft/store.ts";
import { baseConfig, choiceDraft, EXAM, runMain, setupDraftRoot, workPath } from "../draft/test-helpers.ts";
import { EXIT } from "../exit-codes.ts";
import { VerifyRequestSchema } from "../verify/request.ts";
import {
  buildDataset,
  caseId,
  ERROR_KINDS,
  type EvalCase,
  EvalDataError,
  parseDataset,
  UNSUPPORTED_SENTENCE,
} from "./dataset.ts";
import { type CaseResult, computeMetrics, type Targets, verdictOf } from "./metrics.ts";

const draftOf = (text: string, overrides: Partial<ChoiceDraft> = {}) =>
  choiceDraft({ questionText: text, ...overrides });

const bases = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `d-${String(i + 1).padStart(12, "a")}`,
    draft: draftOf(`評価用の架空の設問 ${i + 1} 番です。上限はいくつですか。`),
  }));

describe("評価用のデータ", () => {
  it("同じ入力と同じ種_同じデータになる。誤りのないものと誤りのあるものが同数", () => {
    const a = buildDataset(EXAM, bases(8), { seed: 1, perKind: 2 });
    const b = buildDataset(EXAM, bases(8), { seed: 1, perKind: 2 });
    expect(b).toEqual(a);
    const controls = a.dataset.cases.filter((c) => c.kind === "control");
    const faulty = a.dataset.cases.filter((c) => c.kind !== "control");
    expect(controls.length).toBe(faulty.length);
    expect(faulty.length).toBe(8);
    for (const kind of ERROR_KINDS) expect(faulty.filter((c) => c.kind === kind)).toHaveLength(2);
    expect(parseDataset(a.dataset)).toEqual(a.dataset);
  });

  it("種が違う_割り当てが変わりうる(同じ種なら同じ、違う種なら ID が変わる)", () => {
    const a = buildDataset(EXAM, bases(8), { seed: 1, perKind: 2 }).dataset;
    const b = buildDataset(EXAM, bases(8), { seed: 2, perKind: 2 }).dataset;
    expect(a.cases.map((c) => c.caseId)).not.toEqual(b.cases.map((c) => c.caseId));
  });

  it("評価用の問題の ID_e- で始まり、公開データの問題 ID(大文字の接頭辞-4 桁)と重ならない", () => {
    const { dataset } = buildDataset(EXAM, bases(4), { seed: 1, perKind: 1 });
    for (const c of dataset.cases) {
      expect(c.caseId).toMatch(/^e-[0-9a-f]{12}$/);
      expect(c.caseId).not.toMatch(/^[A-Z][A-Z0-9]{1,15}-\d{4}$/);
    }
  });

  it("仕込んだ誤り_元の下書きとは違い、種類ごとに決まった形で変わる", () => {
    const { dataset } = buildDataset(EXAM, bases(4), { seed: 1, perKind: 1 });
    const byKind = (k: string) => dataset.cases.find((c) => c.kind === k) as EvalCase;
    const baseOf = (c: EvalCase) => bases(4).find((b) => b.id === c.baseDraftId)?.draft as ChoiceDraft;
    const wrong = byKind("wrong-answer");
    expect(wrong.draft.correctAnswers).not.toEqual(baseOf(wrong).correctAnswers);
    expect(byKind("unsupported-claim").draft.explanation).toContain(UNSUPPORTED_SENTENCE);
    const amb = byKind("ambiguous-choice");
    const texts = amb.draft.choices.map((c) => c.text);
    expect(new Set(texts).size).toBeLessThan(texts.length);
    const stale = byKind("stale-fact");
    expect(stale.draft.choices.find((c) => stale.draft.correctAnswers.includes(c.key))?.text).toContain("110");
    expect(stale.draft.explanation).toContain("110");
    for (const c of dataset.cases.filter((x) => x.kind !== "control")) {
      expect(c.draft).not.toEqual(baseOf(c));
      expect(c.expected).toBe("not-pass");
    }
    expect(dataset.cases.filter((c) => c.kind === "control").every((c) => c.expected === "pass")).toBe(true);
  });

  it("仕込めない組_飛ばして数え、対照の数をそれに合わせる。元の下書きが 0 件なら空", () => {
    // 数値がない下書き: stale-fact を仕込めない
    const noDigits = Array.from({ length: 4 }, (_, i) => ({
      id: `d-${String(i + 1).padStart(12, "b")}`,
      draft: draftOf(`数値のない架空の設問 ${["あ", "い", "う", "え"][i]} です。`, {
        choices: [
          { key: "A", text: "選択肢の一" },
          { key: "B", text: "選択肢の二" },
          { key: "C", text: "選択肢の三" },
          { key: "D", text: "選択肢の四" },
        ],
        explanation: "数値を含まない解説です。正解の理由を説明します。",
      }),
    }));
    const r = buildDataset(EXAM, noDigits, { seed: 1, perKind: 1 });
    expect(r.skipped["stale-fact"]).toBe(1);
    expect(r.dataset.cases.filter((c) => c.kind === "stale-fact")).toHaveLength(0);
    const faulty = r.dataset.cases.filter((c) => c.kind !== "control").length;
    expect(r.dataset.cases.filter((c) => c.kind === "control")).toHaveLength(faulty);
    expect(buildDataset(EXAM, [], { seed: 1, perKind: 1 }).dataset.cases).toEqual([]);
  });

  it("元の下書きが足りない_誤りのある例と対照を同じ数に減らす", () => {
    const { dataset } = buildDataset(EXAM, bases(2), { seed: 1, perKind: 3 });
    const controls = dataset.cases.filter((c) => c.kind === "control").length;
    expect(controls).toBe(2);
    expect(dataset.cases.length - controls).toBe(2);
  });

  it("検査_ラベルの欠落・未知の誤りの種類・期待する判定の食い違い・ID の重複・数の不一致を落とす", () => {
    const { dataset } = buildDataset(EXAM, bases(4), { seed: 1, perKind: 1 });
    const mutate = (fn: (cases: Record<string, unknown>[]) => void) => {
      const copy = JSON.parse(JSON.stringify(dataset)) as { cases: Record<string, unknown>[] };
      fn(copy.cases);
      return copy;
    };
    const paths = (raw: unknown) => {
      try {
        parseDataset(raw);
        return [];
      } catch (e) {
        return e instanceof EvalDataError ? e.paths : ["other"];
      }
    };
    expect(paths(mutate((c) => delete c[0]?.kind))).not.toEqual([]);
    expect(
      paths(
        mutate((c) => {
          (c[0] as Record<string, unknown>).kind = "no-such-error";
        }),
      ),
    ).not.toEqual([]);
    expect(
      paths(
        mutate((c) => {
          (c[0] as Record<string, unknown>).expected = "not-pass";
        }),
      ),
    ).toContain("cases.0.expected");
    expect(
      paths(
        mutate((c) => {
          (c[1] as Record<string, unknown>).caseId = c[0]?.caseId;
        }),
      ),
    ).toContain("cases.1.caseId");
    expect(
      paths(
        mutate((c) => {
          c.pop();
        }),
      ),
    ).toContain("cases");
    expect(caseId("d-aaaaaaaaaaaa", "control", 1)).toMatch(/^e-/);
  });
});

const targets: Targets = { detectionOverall: 0.9, detectionPerKind: 0.8, falsePositiveMax: 0.2 };

/** 対照 n 件と、各誤りの種類 n 件を並べたケースの一覧 */
function cases(controls: number, perKind: number): EvalCase[] {
  const base = choiceDraft();
  const make = (kind: EvalCase["kind"], i: number): EvalCase => ({
    caseId: caseId(`d-${String(i).padStart(12, "a")}`, kind, 1),
    baseDraftId: `d-${String(i).padStart(12, "a")}`,
    kind,
    expected: kind === "control" ? "pass" : "not-pass",
    draft: base,
  });
  return [
    ...Array.from({ length: controls }, (_, i) => make("control", i)),
    ...ERROR_KINDS.flatMap((k, ki) => Array.from({ length: perKind }, (_, i) => make(k, 100 * (ki + 1) + i))),
  ];
}

const result = (verdict: "pass" | "hold"): CaseResult =>
  verdict === "pass" ? { rederive: "pass", explanation: "pass" } : { rederive: "hold" };

describe("評価の指標", () => {
  it("手計算の期待値と一致する_種類ごとの検出率・全体の検出率・見落とし率・誤検出率", () => {
    const list = cases(4, 4);
    const results: Record<string, CaseResult> = {};
    // 対照 4 件のうち 1 件を誤検出。誤りのある例は、種類ごとに 4・3・2・1 件を検出
    for (const [i, c] of list.filter((x) => x.kind === "control").entries()) {
      results[c.caseId] = result(i === 0 ? "hold" : "pass");
    }
    const detected: Record<string, number> = {
      "wrong-answer": 4,
      "unsupported-claim": 3,
      "ambiguous-choice": 2,
      "stale-fact": 1,
    };
    for (const kind of ERROR_KINDS) {
      for (const [i, c] of list.filter((x) => x.kind === kind).entries()) {
        results[c.caseId] = result(i < (detected[kind] as number) ? "hold" : "pass");
      }
    }
    const m = computeMetrics(list, results, targets);
    expect(m.detectionByKind["wrong-answer"]).toEqual({ numerator: 4, denominator: 4, rate: 1 });
    expect(m.detectionByKind["unsupported-claim"].rate).toBe(0.75);
    expect(m.detectionByKind["ambiguous-choice"].rate).toBe(0.5);
    expect(m.detectionByKind["stale-fact"].rate).toBe(0.25);
    expect(m.detectionOverall).toEqual({ numerator: 10, denominator: 16, rate: 10 / 16 });
    expect(m.missRate).toEqual({ numerator: 6, denominator: 16, rate: 6 / 16 });
    expect(m.falsePositive).toEqual({ numerator: 1, denominator: 4, rate: 0.25 });
    expect(m.counts).toMatchObject({ cases: 20, controls: 4, faulty: 16, finished: 20, pending: 0, stopped: 0 });
    expect(m.meetsTargets).toBe(false);
    expect(m.belowTarget).toContain("detectionOverall");
    expect(m.belowTarget).toContain("falsePositive");
  });

  it("不採用率_段階ごとに、その段階に進んだものに対する割合で数える", () => {
    const list = cases(2, 1);
    const results: Record<string, CaseResult> = {};
    const [c1, c2, ...rest] = list;
    results[(c1 as EvalCase).caseId] = { rederive: "hold" };
    results[(c2 as EvalCase).caseId] = { rederive: "pass", explanation: "hold" };
    for (const [i, c] of rest.entries()) {
      results[c.caseId] = i === 0 ? { rederive: "pass", explanation: "pass" } : { rederive: "pass" };
    }
    const m = computeMetrics(list, results, targets);
    expect(m.rejectionByStage.rederive.denominator).toBe(list.length);
    expect(m.rejectionByStage.rederive.numerator).toBe(1);
    expect(m.rejectionByStage.explanation.numerator).toBe(1);
    expect(m.rejectionByStage.explanation.denominator).toBe(2);
  });

  it("境界_誤りが 0 件の種類は割合が null(0 除算にならない)。全件を検出、全件を見逃し", () => {
    const empty = computeMetrics(cases(0, 0), {}, targets);
    expect(empty.detectionOverall.rate).toBeNull();
    expect(empty.falsePositive.rate).toBeNull();
    expect(empty.meetsTargets).toBe(false);
    expect(empty.unmeasured).toContain("detectionOverall");
    const list = cases(2, 2);
    const all = Object.fromEntries(list.map((c) => [c.caseId, result(c.kind === "control" ? "pass" : "hold")]));
    const best = computeMetrics(list, all, targets);
    expect(best.detectionOverall.rate).toBe(1);
    expect(best.missRate.rate).toBe(0);
    expect(best.falsePositive.rate).toBe(0);
    expect(best.meetsTargets).toBe(true);
    const none = Object.fromEntries(list.map((c) => [c.caseId, result("pass")]));
    const worst = computeMetrics(list, none, targets);
    expect(worst.detectionOverall.rate).toBe(0);
    expect(worst.missRate.rate).toBe(1);
    expect(worst.meetsTargets).toBe(false);
  });

  it("目標の境界_ちょうど満たす、直下、直上", () => {
    // 誤りのある例 10 件(種類は分けず、1 種類に 10 件)で、検出率の全体の目標 0.9 を試す
    const make = (detect: number): boolean => {
      const list = cases(10, 0).concat(
        Array.from({ length: 10 }, (_, i) => ({
          ...(cases(0, 1)[0] as EvalCase),
          caseId: `e-${String(i).padStart(12, "c")}`,
        })),
      );
      const results: Record<string, CaseResult> = {};
      list.forEach((c) => {
        if (c.kind === "control") results[c.caseId] = result("pass");
      });
      for (const [i, c] of list.filter((x) => x.kind !== "control").entries()) {
        results[c.caseId] = result(i < detect ? "hold" : "pass");
      }
      const m = computeMetrics(list, results, { ...targets, detectionPerKind: 0 });
      // 種類ごとの目標は 0 にして、他の種類は測れない(未測定)ので、全体の目標だけを見る
      return m.belowTarget.includes("detectionOverall");
    };
    expect(make(9)).toBe(false);
    expect(make(8)).toBe(true);
    expect(make(10)).toBe(false);
  });

  it("止めたもの・途中のもの_検出率の分母に入れず、件数に出し、目標を満たしたとはしない", () => {
    const list = cases(2, 1);
    const results: Record<string, CaseResult> = Object.fromEntries(
      list.map((c) => [c.caseId, result(c.kind === "control" ? "pass" : "hold")]),
    );
    const faulty = list.filter((c) => c.kind !== "control");
    results[(faulty[0] as EvalCase).caseId] = { stopped: true };
    delete results[(faulty[1] as EvalCase).caseId];
    const m = computeMetrics(list, results, targets);
    expect(m.counts.stopped).toBe(1);
    expect(m.counts.pending).toBe(1);
    expect(m.detectionOverall.denominator).toBe(faulty.length - 2);
    expect(m.meetsTargets).toBe(false);
    expect(verdictOf({ stopped: true })).toBe("stopped");
    expect(verdictOf(undefined)).toBe("pending");
    expect(verdictOf({ rederive: "pass" })).toBe("pending");
  });
});

// ---- コマンド ----

/** 人が承認した選択式の下書きを n 件、作業用の置き場に置く */
function withApproved(n: number) {
  const root = setupDraftRoot();
  const records: DraftRecord[] = Array.from({ length: n }, (_, i) => ({
    id: `d-${String(i + 1).padStart(12, "a")}`,
    planItemId: "p-aaaaaaaaaaaa",
    domain: "domain1",
    difficulty: "easy",
    status: "passed",
    reasons: [],
    warnings: [],
    draft: choiceDraft({
      questionText: `評価の架空の設問その${["一", "二", "三", "四", "五", "六"][i]}。上限はいくつですか。`,
      factIds: ["f-111111111111"],
    }),
  }));
  mkdirSync(workPath(root), { recursive: true });
  writeDrafts(workPath(root, "drafts.json"), { examCode: EXAM, drafts: records });
  writeDecisions(decisionsPath(join(root, baseConfig.decisionsDir), EXAM), {
    examCode: EXAM,
    decisions: records.map((r) => ({
      target: "draft" as const,
      id: r.id,
      decision: "approve" as const,
      reason: "reviewed",
    })),
  });
  return root;
}

const evalDir = (root: string, ...parts: string[]) => join(root, baseConfig.workDir, "eval", "aws-aib-c01", ...parts);

function evalRequests(root: string) {
  const dir = evalDir(root, "requests");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((f) => VerifyRequestSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

/** 検証役の代わりに、元の下書きの正解を真として判定する。誤りを見つけるのは、誤った正解と節にない断定だけ */
function stubVerifier(root: string) {
  for (const request of evalRequests(root)) {
    const outPath = join(root, request.outputPath);
    if (existsSync(outPath)) continue;
    mkdirSync(join(outPath, ".."), { recursive: true });
    const base = {
      examCode: request.examCode,
      requestKey: request.requestKey,
      draftId: request.draftId,
      check: request.check,
    };
    if (request.check === "rederive") {
      // 元の下書きの正解は B(choiceDraft の既定)
      writeFileSync(
        outPath,
        JSON.stringify({
          ...base,
          judgements: request.choices.map((c) => ({
            key: c.key,
            judgement: c.key === "B" ? "correct" : "incorrect",
            evidence: { heading: request.sections[0]?.heading, summary: "節の内容と整合する(言い換え)" },
          })),
        }),
      );
    } else {
      const flagged = request.explanation.includes(UNSUPPORTED_SENTENCE.slice(0, 12));
      writeFileSync(
        outPath,
        JSON.stringify({ ...base, findings: flagged ? [{ where: "explanation", code: "overclaim" }] : [] }),
      );
    }
  }
}

describe("eval コマンド", () => {
  it("人が承認した下書きがない_評価用のデータを作れず、入力の誤りで止まる", async () => {
    const root = setupDraftRoot();
    const r = await runMain(root, ["eval", EXAM]);
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("人が承認した選択式の下書きがない");
  });

  it("依頼_評価用のデータを作業用の置き場にだけ作り、data/ は変えず、検証と同じ形の依頼を書く。再導出の依頼に正解・解説は載せない", async () => {
    const root = withApproved(6);
    const dataBefore = readFileSync(join(root, "data/exams.json"), "utf8");
    const r = await runMain(root, ["eval", EXAM]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("評価用のデータ: 対照");
    const dataset = JSON.parse(readFileSync(evalDir(root, "dataset.json"), "utf8"));
    expect(dataset.seed).toBe(baseConfig.eval.seed);
    const requests = evalRequests(root);
    expect(requests.length).toBe(dataset.cases.length);
    expect(requests.every((q) => q.check === "rederive" && q.draftId.startsWith("e-"))).toBe(true);
    const text = readFileSync(
      join(evalDir(root, "requests"), readdirSync(evalDir(root, "requests"))[0] as string),
      "utf8",
    );
    for (const secret of ["correctAnswers", "distractors", "explanation"]) expect(text).not.toContain(secret);
    expect(readFileSync(join(root, "data/exams.json"), "utf8")).toBe(dataBefore);
    // 同じ入力で再実行しても、データも依頼も増えない
    const datasetText = readFileSync(evalDir(root, "dataset.json"), "utf8");
    await runMain(root, ["eval", EXAM]);
    expect(readFileSync(evalDir(root, "dataset.json"), "utf8")).toBe(datasetText);
    expect(evalRequests(root)).toHaveLength(requests.length);
  });

  it("取り込み_期待する判定と照合して、種類ごとの検出率・誤検出率のレポートを書く。レポートに定義・モデル・データのハッシュ・日付があり、本文はない。結果に選択肢ごとの判定と指摘の場所・理由コードを残す", async () => {
    const root = withApproved(6);
    await runMain(root, ["eval", EXAM]);
    stubVerifier(root);
    await runMain(root, ["eval", EXAM, "--import"]);
    await runMain(root, ["eval", EXAM]);
    stubVerifier(root);
    const r = await runMain(root, ["eval", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.ok);
    const report = JSON.parse(readFileSync(evalDir(root, "report.json"), "utf8"));
    expect(report.agent.role).toBe("question-verifier");
    expect(report.agent.model).toMatch(/^claude-/);
    expect(report.agent.definitionHash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.dataset.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(report.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    // 元の正解を真とする検証役: 誤った正解と節にない断定は見つけ、曖昧な選択肢と古い版の記述は見逃す。誤検出はない
    const m = report.metrics;
    expect(m.detectionByKind["wrong-answer"].rate).toBe(1);
    expect(m.detectionByKind["unsupported-claim"].rate).toBe(1);
    expect(m.detectionByKind["ambiguous-choice"].rate).toBe(0);
    expect(m.detectionByKind["stale-fact"].rate).toBe(0);
    expect(m.falsePositive.rate).toBe(0);
    // 対照 6 件に合わせて、誤りのある例は 6 件(誤った正解 2・根拠のない主張 2・曖昧な選択肢 1・古い版の記述 1)。4 件を見つける
    expect(m.detectionOverall).toEqual({ numerator: 4, denominator: 6, rate: 4 / 6 });
    expect(m.meetsTargets).toBe(false);
    expect(m.counts.pending).toBe(0);
    expect(r.out).toContain("評価の指標: 検出率(全体) 66.7% 4/6");
    // 結果には、起動ごとの一致を比べるための、選択肢ごとの判定と、指摘の場所・理由コードだけを残す
    const results = JSON.parse(readFileSync(evalDir(root, "results.json"), "utf8")) as Record<
      string,
      { choices?: Record<string, string>; findings?: string[] }
    >;
    const finished = Object.values(results);
    expect(finished.every((x) => x.choices !== undefined && Object.keys(x.choices).length > 0)).toBe(true);
    expect(finished.some((x) => x.choices?.B === "correct")).toBe(true);
    expect(finished.some((x) => x.findings?.includes("explanation overclaim"))).toBe(true);
    const md = readFileSync(evalDir(root, "report.md"), "utf8");
    expect(md).toContain("# 検証役の評価");
    const everything = md + JSON.stringify(report) + JSON.stringify(results) + r.out + r.err;
    expect(everything).not.toContain("評価の架空の設問");
    expect(everything).not.toContain("上限はいくつですか");
    expect(everything).not.toContain("100 個");
  });

  it("--bundles_待っている評価の依頼を、検証と同じ束の大きさで区切って挙げ、何も書かない", async () => {
    const root = withApproved(6);
    await runMain(root, ["eval", EXAM]);
    const requests = evalRequests(root);
    const before = readdirSync(evalDir(root, "requests")).sort();
    const r = await runMain(root, ["eval", EXAM, "--bundles"], { verify: { ...baseConfig.verify, bundleSize: 5 } });
    expect(r.code).toBe(EXIT.ok);
    const lines = r.out.split("\n").filter((l) => l.startsWith("評価の束: rederive "));
    expect(lines).toHaveLength(Math.ceil(requests.length / 5));
    const listed = lines.flatMap((l) => l.split(" ").slice(4));
    expect(listed).toHaveLength(requests.length);
    expect(readdirSync(evalDir(root, "requests")).sort()).toEqual(before);
  });

  it("出力の形が違い、出し直しの上限に達した_止めたものとして数え、評価の割合の分母に入れない", async () => {
    const root = withApproved(6);
    await runMain(root, ["eval", EXAM]);
    const request = evalRequests(root)[0];
    for (let i = 0; i < baseConfig.eval.maxAttempts; i++) {
      mkdirSync(join(root, request?.outputPath ?? "", ".."), { recursive: true });
      writeFileSync(join(root, request?.outputPath ?? ""), JSON.stringify({ judgements: "壊れている" }));
      const r = await runMain(root, ["eval", EXAM, "--import"]);
      expect(r.code).toBe(EXIT.checkFailed);
      expect(r.err).toContain("output-invalid");
    }
    // 止めたものが残る間は、依頼を書く実行も検査の失敗で終わる
    expect((await runMain(root, ["eval", EXAM])).code).toBe(EXIT.checkFailed);
    const report = JSON.parse(readFileSync(evalDir(root, "report.json"), "utf8"));
    expect(report.metrics.counts.stopped).toBe(1);
    expect(report.metrics.meetsTargets).toBe(false);
  });

  it("依頼のあとに検証役の定義が変わった_request-stale で捨て、定義が変わった記録でレポートを書き直す", async () => {
    const root = withApproved(6);
    await runMain(root, ["eval", EXAM]);
    stubVerifier(root);
    const path = join(root, ".claude", "agents", "question-verifier.md");
    writeFileSync(path, `${readFileSync(path, "utf8")}\n- 追加した指示\n`);
    const r = await runMain(root, ["eval", EXAM, "--import"]);
    expect(r.err).toContain("request-stale");
    expect(existsSync(evalDir(root, "dataset.json"))).toBe(true);
  });

  it("dry-run_評価用のデータも依頼も書かない", async () => {
    const root = withApproved(6);
    const r = await runMain(root, ["eval", EXAM, "--dry-run"]);
    expect(r.code).toBe(EXIT.ok);
    expect(existsSync(evalDir(root, "dataset.json"))).toBe(false);
    expect(existsSync(evalDir(root, "requests"))).toBe(false);
  });

  it("壊れた評価用のデータ_場所だけを報告して終了コード 1 になる", async () => {
    const root = withApproved(6);
    await runMain(root, ["eval", EXAM]);
    writeFileSync(
      evalDir(root, "dataset.json"),
      JSON.stringify({ examCode: EXAM, seed: 1, perKind: 1, cases: [{ caseId: "x" }] }),
    );
    const r = await runMain(root, ["eval", EXAM]);
    expect(r.code).toBe(EXIT.checkFailed);
    expect(r.err).toContain("評価用データの誤り: cases.0");
  });
});
