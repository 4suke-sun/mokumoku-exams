import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { decisionsPath, writeDecisions } from "../decisions/decisions.ts";
import type { ChoiceDraft } from "../draft/schema.ts";
import { type DraftRecord, writeDrafts } from "../draft/store.ts";
import { baseConfig, choiceDraft, runMain, setupDraftRoot, workPath } from "../draft/test-helpers.ts";
import { caseId as evalCaseId } from "../eval/dataset.ts";
import { EXIT } from "../exit-codes.ts";
import { inputFromDraft, type JudgeInput, toScoreInput } from "../judge/input.ts";
import { type JudgeRequest, JudgeRequestSchema } from "../judge/request.ts";
import type { JudgeCode } from "../judge/schema.ts";
import { goodQuestion, weakQuestion } from "../judge/test-helpers.ts";
import { resolveProfile } from "../scorecard/profiles.ts";
import { questionPasses, scoreQuestion } from "../scorecard/score.ts";
import {
  buildJudgeDataset,
  caseId,
  DEFECT_KINDS,
  EXPECTED_CODES,
  type JudgeEvalCase,
  JudgeEvalDataError,
  NOISE_CHOICE,
  parseJudgeDataset,
  UNNATURAL_SENTENCE,
  unknownExpectedCodes,
} from "./dataset.ts";
import { caseVerdictOf, computeJudgeMetrics, type JudgeCaseResult, type JudgeTargets } from "./metrics.ts";

const EXAM = "AWS-AIB-C01";

/** 点数票の AIB の帯を満たす下書き(n で言い回しを変える) */
function aibDraft(n: number, overrides: Partial<ChoiceDraft> = {}): ChoiceDraft {
  const q = goodQuestion(n);
  return choiceDraft({
    questionText: q.questionText,
    choices: q.choices,
    correctAnswers: q.correctAnswers,
    explanation: q.explanation,
    distractors: undefined,
    ...overrides,
  });
}

const bases = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    id: `d-${String(i + 1).padStart(12, "a")}`,
    input: inputFromDraft(`d-${String(i + 1).padStart(12, "a")}`, aibDraft(i + 1)),
  }));

describe("判定役の評価用のデータ", () => {
  it("同じ入力と同じ種_同じデータになり_基準を満たすものと欠陥のあるものが同数", () => {
    const a = buildJudgeDataset(EXAM, bases(10), { seed: 1, perKind: 2 });
    const b = buildJudgeDataset(EXAM, bases(10), { seed: 1, perKind: 2 });
    expect(b).toEqual(a);
    const controls = a.dataset.cases.filter((c) => c.kind === "control");
    const faulty = a.dataset.cases.filter((c) => c.kind !== "control");
    expect(controls.length).toBe(faulty.length);
    expect(faulty.length).toBe(DEFECT_KINDS.length * 2);
    for (const kind of DEFECT_KINDS) expect(faulty.filter((c) => c.kind === kind)).toHaveLength(2);
    expect(parseJudgeDataset(a.dataset)).toEqual(a.dataset);
  });

  it("種が違う_事例の ID が変わる。事例の ID は e- で始まり、公開データの ID と重ならない", () => {
    const a = buildJudgeDataset(EXAM, bases(8), { seed: 1, perKind: 1 }).dataset;
    const b = buildJudgeDataset(EXAM, bases(8), { seed: 2, perKind: 1 }).dataset;
    expect(a.cases.map((c) => c.caseId)).not.toEqual(b.cases.map((c) => c.caseId));
    for (const c of a.cases) {
      expect(c.caseId).toMatch(/^e-[0-9a-f]{12}$/);
      expect(c.input.questionId).toBe(c.caseId);
    }
  });

  it("検証役の評価の事例の ID と判定役の評価の事例の ID_同じ元の下書きと種でも重ならない", () => {
    expect(caseId("d-aaaaaaaaaaaa", "control", 1)).toMatch(/^e-/);
    expect(caseId("d-aaaaaaaaaaaa", "control", 1)).not.toBe(evalCaseId("d-aaaaaaaaaaaa", "control", 1));
  });

  it("仕込んだ欠陥_元の問題とは違い_種類ごとに決まった形で変わる", () => {
    const list = bases(8);
    const { dataset } = buildJudgeDataset(EXAM, list, { seed: 1, perKind: 1 });
    const byKind = (k: string) => dataset.cases.find((c) => c.kind === k) as JudgeEvalCase;
    const baseOf = (c: JudgeEvalCase) => list.find((b) => b.id === c.baseDraftId)?.input as JudgeInput;
    const broken = byKind("type-broken");
    expect(broken.input.questionText).not.toContain("\n\n");
    expect(broken.input.questionText).toBe("これらの要件を満たすために、最初に実施すべきことはどれですか。");
    expect(byKind("situation-unnatural").input.questionText).toContain(UNNATURAL_SENTENCE);
    expect(byKind("situation-unnatural").input.questionText).toContain("\n\nこれらの要件");
    const weak = byKind("choices-weak");
    expect(weak.input.choices.filter((c) => c.text === NOISE_CHOICE)).toHaveLength(1);
    expect(weak.input.correctAnswers).toEqual(baseOf(weak).correctAnswers);
    expect(byKind("explanation-inconsistent").input.explanation).toMatch(/^正解は選択肢 [B-D] です。/);
    const dup = byKind("not-unique").input.choices.map((c) => c.text);
    expect(new Set(dup).size).toBeLessThan(dup.length);
    for (const c of dataset.cases.filter((x) => x.kind !== "control")) {
      expect({ ...c.input, questionId: "" }).not.toEqual({ ...baseOf(c), questionId: "" });
      expect(c.expected).toBe("not-publish");
    }
    expect(dataset.cases.filter((c) => c.kind === "control").every((c) => c.expected === "publish")).toBe(true);
  });

  it("対照_元の問題と同じ内容(事例の ID だけが違う)", () => {
    const list = bases(4);
    const { dataset } = buildJudgeDataset(EXAM, list, { seed: 1, perKind: 1 });
    for (const c of dataset.cases.filter((x) => x.kind === "control")) {
      const base = list.find((b) => b.id === c.baseDraftId)?.input as JudgeInput;
      expect({ ...c.input, questionId: "" }).toEqual({ ...base, questionId: "" });
    }
  });

  it("状況が元からない設問_型を崩す欠陥は仕込めず飛ばして数え_対照の数を合わせる", () => {
    const noSituation = Array.from({ length: 4 }, (_, i) => ({
      id: `d-${String(i + 1).padStart(12, "b")}`,
      input: inputFromDraft(
        `d-${String(i + 1).padStart(12, "b")}`,
        aibDraft(i + 1, { questionText: `生成 AI の運用の設問その${i}で、最も適切なものを選んでください` }),
      ),
    }));
    const r = buildJudgeDataset(EXAM, noSituation, { seed: 1, perKind: 1 });
    expect(r.skipped["type-broken"]).toBe(1);
    expect(r.dataset.cases.filter((c) => c.kind === "type-broken")).toHaveLength(0);
    const faulty = r.dataset.cases.filter((c) => c.kind !== "control").length;
    expect(r.dataset.cases.filter((c) => c.kind === "control")).toHaveLength(faulty);
    expect(buildJudgeDataset(EXAM, [], { seed: 1, perKind: 1 }).dataset.cases).toEqual([]);
  });

  it("元の問題が足りない_欠陥のある例と対照を同じ数に減らす", () => {
    const { dataset } = buildJudgeDataset(EXAM, bases(2), { seed: 1, perKind: 3 });
    const controls = dataset.cases.filter((c) => c.kind === "control").length;
    expect(controls).toBe(2);
    expect(dataset.cases.length - controls).toBe(2);
  });

  it("検査_ラベルの欠落・未知の欠陥・期待の食い違い・ID の重複・事例の ID と問題の ID の不一致・数の不一致を落とす", () => {
    const { dataset } = buildJudgeDataset(EXAM, bases(4), { seed: 1, perKind: 1 });
    const mutate = (fn: (cases: Record<string, unknown>[]) => void) => {
      const copy = JSON.parse(JSON.stringify(dataset)) as { cases: Record<string, unknown>[] };
      fn(copy.cases);
      return copy;
    };
    const paths = (raw: unknown) => {
      try {
        parseJudgeDataset(raw);
        return [];
      } catch (e) {
        return e instanceof JudgeEvalDataError ? e.paths : ["other"];
      }
    };
    expect(paths(dataset)).toEqual([]);
    expect(paths(mutate((c) => delete c[0]?.kind))).not.toEqual([]);
    expect(
      paths(
        mutate((c) => {
          (c[0] as Record<string, unknown>).kind = "no-such-defect";
        }),
      ),
    ).not.toEqual([]);
    expect(
      paths(
        mutate((c) => {
          (c[0] as Record<string, unknown>).expected = "not-publish";
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
          ((c[0] as { input: Record<string, unknown> }).input as Record<string, unknown>).questionId = "e-ffffffffffff";
        }),
      ),
    ).toContain("cases.0.input.questionId");
    expect(
      paths(
        mutate((c) => {
          c.pop();
        }),
      ),
    ).toContain("cases");
  });

  it("欠陥ごとの期待する理由コード_理由コードの一覧にある", () => {
    expect(unknownExpectedCodes()).toEqual([]);
    for (const kind of DEFECT_KINDS) expect(EXPECTED_CODES[kind].length).toBeGreaterThan(0);
  });
});

const targets: JudgeTargets = { detectionOverall: 0.9, detectionPerKind: 0.8, falsePositiveMax: 0.2 };

/** 対照 n 件と、各欠陥の種類 n 件を並べた事例の一覧 */
function cases(controls: number, perKind: number): JudgeEvalCase[] {
  const input = (id: string) => ({ ...inputFromDraft(id, aibDraft(1)), questionId: id }) as JudgeEvalCase["input"];
  const make = (kind: JudgeEvalCase["kind"], i: number): JudgeEvalCase => {
    const id = caseId(`d-${String(i).padStart(12, "a")}`, kind, 1);
    return {
      caseId: id,
      baseDraftId: `d-${String(i).padStart(12, "a")}`,
      kind,
      expected: kind === "control" ? "publish" : "not-publish",
      input: input(id),
    };
  };
  return [
    ...Array.from({ length: controls }, (_, i) => make("control", i)),
    ...DEFECT_KINDS.flatMap((k, ki) => Array.from({ length: perKind }, (_, i) => make(k, 100 * (ki + 1) + i))),
  ];
}

const flagged = (...codes: JudgeCode[]): JudgeCaseResult => ({ verdict: "rewritable", codes });
const firstCode = (kind: keyof typeof EXPECTED_CODES) => EXPECTED_CODES[kind][0] as JudgeCode;
const published: JudgeCaseResult = { verdict: "publish", codes: [] };

describe("判定役の評価の指標", () => {
  it("手計算の期待値と一致する_欠陥ごとの検出率・全体の検出率・見落とし率・誤検出率・理由コードの一致率", () => {
    const list = cases(4, 4);
    const results: Record<string, JudgeCaseResult> = {};
    for (const [i, c] of list.filter((x) => x.kind === "control").entries()) {
      results[c.caseId] = i === 0 ? flagged("choices-weak") : published;
    }
    const detected: Record<string, number> = {
      "type-broken": 4,
      "situation-unnatural": 3,
      "choices-weak": 2,
      "explanation-inconsistent": 1,
      "not-unique": 0,
    };
    for (const kind of DEFECT_KINDS) {
      for (const [i, c] of list.filter((x) => x.kind === kind).entries()) {
        // 検出したものは、期待する理由コード(最初の 1 件は別の理由コード)を挙げる
        const expected = firstCode(kind);
        results[c.caseId] =
          i < (detected[kind] as number)
            ? flagged(i === 0 && kind !== "type-broken" ? "out-of-scope" : expected)
            : published;
      }
    }
    const m = computeJudgeMetrics(list, results, targets);
    expect(m.detectionByKind["type-broken"]).toEqual({ numerator: 4, denominator: 4, rate: 1 });
    expect(m.detectionByKind["situation-unnatural"].rate).toBe(0.75);
    expect(m.detectionByKind["choices-weak"].rate).toBe(0.5);
    expect(m.detectionByKind["explanation-inconsistent"].rate).toBe(0.25);
    expect(m.detectionByKind["not-unique"].rate).toBe(0);
    expect(m.detectionOverall).toEqual({ numerator: 10, denominator: 20, rate: 0.5 });
    expect(m.missRate).toEqual({ numerator: 10, denominator: 20, rate: 0.5 });
    expect(m.falsePositive).toEqual({ numerator: 1, denominator: 4, rate: 0.25 });
    // 検出した 10 件のうち、別の理由コードだけを挙げたのは 3 件(situation 1、choices 1、explanation 1)。type-broken は 4 件とも一致
    expect(m.codeMatch).toEqual({ numerator: 7, denominator: 10, rate: 0.7 });
    expect(m.counts).toMatchObject({ cases: 24, controls: 4, faulty: 20, finished: 24, pending: 0, stopped: 0 });
    expect(m.meetsTargets).toBe(false);
    expect(m.belowTarget).toEqual(
      expect.arrayContaining(["detectionOverall", "detection:not-unique", "falsePositive"]),
    );
  });

  it("境界_欠陥が 0 件の種類は割合が null で_全件検出は目標を満たし_全件見逃しは満たさない", () => {
    const empty = computeJudgeMetrics(cases(0, 0), {}, targets);
    expect(empty.detectionOverall.rate).toBeNull();
    expect(empty.codeMatch.rate).toBeNull();
    expect(empty.unmeasured).toContain("detectionOverall");
    expect(empty.meetsTargets).toBe(false);
    const list = cases(2, 2);
    const best = computeJudgeMetrics(
      list,
      Object.fromEntries(
        list.map((c) => [
          c.caseId,
          c.kind === "control" ? published : flagged(firstCode(c.kind as keyof typeof EXPECTED_CODES)),
        ]),
      ),
      targets,
    );
    expect(best.detectionOverall.rate).toBe(1);
    expect(best.codeMatch.rate).toBe(1);
    expect(best.missRate.rate).toBe(0);
    expect(best.falsePositive.rate).toBe(0);
    expect(best.meetsTargets).toBe(true);
    const worst = computeJudgeMetrics(list, Object.fromEntries(list.map((c) => [c.caseId, published])), targets);
    expect(worst.detectionOverall.rate).toBe(0);
    expect(worst.missRate.rate).toBe(1);
    expect(worst.meetsTargets).toBe(false);
  });

  it("止めたもの・途中のもの_分母に入れず件数に出し_目標を満たしたとはしない", () => {
    const list = cases(2, 1);
    const results: Record<string, JudgeCaseResult> = Object.fromEntries(
      list.map((c) => [c.caseId, c.kind === "control" ? published : flagged("choices-weak")]),
    );
    const faulty = list.filter((c) => c.kind !== "control");
    results[(faulty[0] as JudgeEvalCase).caseId] = { stopped: true };
    delete results[(faulty[1] as JudgeEvalCase).caseId];
    const m = computeJudgeMetrics(list, results, targets);
    expect(m.counts.stopped).toBe(1);
    expect(m.counts.pending).toBe(1);
    expect(m.detectionOverall.denominator).toBe(faulty.length - 2);
    expect(m.meetsTargets).toBe(false);
    expect(caseVerdictOf({ stopped: true })).toBe("stopped");
    expect(caseVerdictOf(undefined)).toBe("pending");
    expect(caseVerdictOf({ codes: [] })).toBe("pending");
    expect(caseVerdictOf({ verdict: "unpublish", codes: ["not-unique"] })).toBe("flagged");
  });
});

// ---- コマンド ----

/** 人が承認した選択式の下書きを n 件、作業用の置き場に置く。weak 件は、点数票の機械の観点を満たさない下書き */
function withApproved(n: number, weak = 0) {
  const root = setupDraftRoot();
  const records: DraftRecord[] = Array.from({ length: n + weak }, (_, i) => ({
    id: `d-${String(i + 1).padStart(12, "a")}`,
    planItemId: "p-aaaaaaaaaaaa",
    domain: "domain1",
    difficulty: "easy",
    status: "passed",
    reasons: [],
    warnings: [],
    draft:
      i < n
        ? aibDraft(i + 1)
        : choiceDraft({
            questionText: `AI の説明として正しいものはどれですか(その${i})。`,
            choices: weakQuestion(i).choices,
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
  // 判定の基準の文書
  mkdirSync(join(root, "docs/exam-style"), { recursive: true });
  writeFileSync(
    join(root, "docs/exam-style/aws-aib.md"),
    readFileSync(join(import.meta.dirname, "../../../../docs/exam-style/aws-aib.md"), "utf8"),
  );
  return root;
}

const evalDir = (root: string, ...parts: string[]) =>
  join(root, baseConfig.workDir, "judge-eval", "aws-aib-c01", ...parts);

function evalRequests(root: string): JudgeRequest[] {
  const dir = evalDir(root, "requests");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .sort()
    .map((f) => JudgeRequestSchema.parse(JSON.parse(readFileSync(join(dir, f), "utf8"))));
}

/** 判定役の代わりに、仕込んだ欠陥の目印から判定する(欠陥がなければ publish) */
function stubJudge(root: string, request: JudgeRequest, skip: (kindHint: string) => boolean = () => false) {
  const findings: { code: string; where: string }[] = [];
  const hint = (kind: string, code: string, where: string) => {
    if (skip(kind)) return;
    findings.push({ code, where });
  };
  if (!request.questionText.includes("\n\n")) hint("type-broken", "type-mismatch", "questionText");
  if (request.questionText.includes(UNNATURAL_SENTENCE))
    hint("situation-unnatural", "situation-unnatural", "questionText");
  const noise = request.choices.find((c) => c.text === NOISE_CHOICE);
  if (noise) hint("choices-weak", "choices-weak", `choices.${noise.key}`);
  if (request.explanation.startsWith("正解は選択肢"))
    hint("explanation-inconsistent", "explanation-inconsistent", "explanation");
  if (new Set(request.choices.map((c) => c.text)).size < request.choices.length)
    hint("not-unique", "not-unique", "questionText");
  const unpublish = findings.some((f) => f.code === "not-unique");
  const output = {
    examCode: request.examCode,
    requestKey: request.requestKey,
    questionId: request.questionId,
    verdict: findings.length === 0 ? "publish" : unpublish ? "unpublish" : "rewritable",
    findings,
  };
  const path = join(root, request.outputPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, JSON.stringify(output));
}

describe("judge-eval コマンド", () => {
  it("承認した下書き_機械の観点を満たすものだけから評価用のデータを作り_依頼を書く", async () => {
    const root = withApproved(8, 2);
    const r = await runMain(root, ["judge-eval", EXAM]);
    expect(r.code, r.err).toBe(EXIT.ok);
    const dataset = parseJudgeDataset(JSON.parse(readFileSync(evalDir(root, "dataset.json"), "utf8")));
    const baseIds = new Set(dataset.cases.map((c) => c.baseDraftId));
    // 点数票の機械の観点を満たさない下書き(9 件目と 10 件目)は、元にしない
    const weakIds = ["d-aaaaaaaaaaa9", "d-aaaaaaaaaa10"];
    for (const id of weakIds) expect(baseIds.has(id)).toBe(false);
    const goodIds = Array.from({ length: 8 }, (_, i) => `d-${String(i + 1).padStart(12, "a")}`);
    expect([...baseIds].every((id) => goodIds.includes(id))).toBe(true);
    const profile = resolveProfile(EXAM);
    for (const c of dataset.cases.filter((x) => x.kind === "control")) {
      expect(questionPasses(scoreQuestion(toScoreInput(c.input), profile as NonNullable<typeof profile>))).toBe(true);
    }
    const requests = evalRequests(root);
    expect(requests).toHaveLength(dataset.cases.length);
    expect(requests.every((q) => q.questionId.startsWith("e-"))).toBe(true);
    expect(r.out).toContain("評価用のデータ: 対照");
  });

  it("承認した下書きがない・機械の観点を満たす下書きがない_入力の誤りとして止まる", async () => {
    const none = withApproved(0, 0);
    expect((await runMain(none, ["judge-eval", EXAM])).code).toBe(EXIT.inputError);
    const onlyWeak = withApproved(0, 3);
    const r = await runMain(onlyWeak, ["judge-eval", EXAM]);
    expect(r.code).toBe(EXIT.inputError);
    expect(r.err).toContain("評価用のデータを作れない");
  });

  it("判定役が欠陥を見つける_取り込んでレポートを書き_目標を満たす。本文は載らない", async () => {
    const root = withApproved(10);
    await runMain(root, ["judge-eval", EXAM]);
    for (const request of evalRequests(root)) stubJudge(root, request);
    const r = await runMain(root, ["judge-eval", EXAM, "--import"]);
    expect(r.code, r.err).toBe(EXIT.ok);
    expect(r.out).toContain("評価の指標: 検出率(全体) 100.0%");
    expect(r.out).toContain("評価の指標: 誤検出率 0.0%");
    expect(r.out).toContain("評価の指標: 理由コードの一致率 100.0%");
    expect(r.out).toContain("評価の指標: 目標 満たした");
    const report = JSON.parse(readFileSync(evalDir(root, "report.json"), "utf8"));
    expect(report.metrics.meetsTargets).toBe(true);
    expect(report.agent.role).toBe("question-judge");
    expect(report.criteriaHash).toMatch(/^[0-9a-f]{64}$/);
    const text = readFileSync(evalDir(root, "report.md"), "utf8") + readFileSync(evalDir(root, "report.json"), "utf8");
    expect(text).not.toContain("最初に実施すべきことはどれですか");
    expect(text).not.toContain(UNNATURAL_SENTENCE);
    expect(evalRequests(root)).toHaveLength(0);
  });

  it("判定役が一部の欠陥を見逃す_見落とし率に出て_目標を下回る", async () => {
    const root = withApproved(10);
    await runMain(root, ["judge-eval", EXAM]);
    for (const request of evalRequests(root)) stubJudge(root, request, (kind) => kind === "choices-weak");
    const r = await runMain(root, ["judge-eval", EXAM, "--import"]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("評価の指標: 検出率(choices-weak) 0.0%");
    expect(r.out).toContain("評価の指標: 目標 満たしていない");
    const report = JSON.parse(readFileSync(evalDir(root, "report.json"), "utf8"));
    expect(report.metrics.belowTarget).toContain("detection:choices-weak");
  });

  it("形が違う出力が上限まで続く_止めたものとして数え_次の依頼を出さない", async () => {
    const root = withApproved(4);
    await runMain(root, ["judge-eval", EXAM]);
    const first = evalRequests(root)[0] as JudgeRequest;
    for (let i = 0; i < baseConfig.judge.maxAttempts; i++) {
      const [request] = evalRequests(root).filter((q) => q.requestKey === first.requestKey);
      const path = join(root, (request as JudgeRequest).outputPath);
      mkdirSync(join(path, ".."), { recursive: true });
      writeFileSync(path, JSON.stringify({ verdict: "bad" }));
      await runMain(root, ["judge-eval", EXAM, "--import"]);
    }
    const r = await runMain(root, ["judge-eval", EXAM, "--import"]);
    expect(r.out).toContain("止めた 1 件");
    const req = await runMain(root, ["judge-eval", EXAM]);
    expect(req.code).toBe(EXIT.checkFailed);
  });

  it("判定役の定義が変わった_古い依頼の出力を取り込まず捨てる", async () => {
    const root = withApproved(4);
    await runMain(root, ["judge-eval", EXAM]);
    for (const request of evalRequests(root)) stubJudge(root, request);
    const def = join(root, ".claude/agents/question-judge.md");
    writeFileSync(def, `${readFileSync(def, "utf8")}\n- 指示を足した。\n`);
    const r = await runMain(root, ["judge-eval", EXAM, "--import"]);
    expect(r.err).toContain("request-stale");
    expect(evalRequests(root)).toHaveLength(0);
    expect(existsSync(evalDir(root, "results.json"))).toBe(false);
  });

  it("データがある_作り直さず_dry-run は何も書かない", async () => {
    const root = withApproved(4);
    await runMain(root, ["judge-eval", EXAM, "--dry-run"]);
    expect(existsSync(evalDir(root))).toBe(false);
    await runMain(root, ["judge-eval", EXAM]);
    const before = readFileSync(evalDir(root, "dataset.json"), "utf8");
    await runMain(root, ["judge-eval", EXAM]);
    expect(readFileSync(evalDir(root, "dataset.json"), "utf8")).toBe(before);
  });
});
