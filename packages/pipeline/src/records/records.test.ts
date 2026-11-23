import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { sha256 } from "../collect/fetcher.ts";
import { type Config, loadConfig } from "../config.ts";
import { baseConfig, runMain, setupDraftRoot } from "../draft/test-helpers.ts";
import type { EvalCase } from "../eval/dataset.ts";
import { EXIT } from "../exit-codes.ts";
import { checkGate, runEvalGate } from "../gate/run.ts";
import { canonicalJson, settingsOf, subjectOf } from "../gate/subjects.ts";
import { checkTuningConsistency } from "../tuning/run.ts";
import { holdCount, parseTargets, sameTargets, sweep } from "../tuning/sweep.ts";
import { appendRecord, type GateRecord, gatePath, RecordsError, readGate, readTuning, tuningPath } from "./store.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const HASH = "a".repeat(64);

const caseOf = (n: number, kind: EvalCase["kind"]): EvalCase =>
  ({ caseId: `e-${String(n).padStart(12, "0")}`, baseDraftId: `d-${String(n).padStart(12, "a")}`, kind }) as EvalCase;

describe("しきい値の候補", () => {
  it("正しい形_数に直し_形が違うものはnullにする", () => {
    expect(parseTargets("0.9/0.8/0.2")).toEqual({
      detectionOverall: 0.9,
      detectionPerKind: 0.8,
      falsePositiveMax: 0.2,
    });
    expect(parseTargets("1/0/0.5")).not.toBeNull();
    for (const bad of ["0.9/0.8", "a/b/c", "1.5/0.8/0.2", "0.9/0.8/0.2/0.1", "-0.1/0.8/0.2", ""]) {
      expect(parseTargets(bad), bad).toBeNull();
    }
  });

  it("同じ値の組_同じ候補として扱う", () => {
    const a = parseTargets("0.9/0.8/0.2");
    const b = parseTargets("0.9/0.8/0.2");
    if (a === null || b === null) throw new Error("形");
    expect(sameTargets(a, b)).toBe(true);
    expect(sameTargets(a, { ...b, falsePositiveMax: 0.3 })).toBe(false);
  });
});

describe("sweep", () => {
  // 誤りのある例 4 件のうち 3 件を保留(検出率 75%)、対照 2 件のうち 1 件を保留(誤検出率 50%)
  const cases = [
    caseOf(1, "wrong-answer"),
    caseOf(2, "unsupported-claim"),
    caseOf(3, "ambiguous-choice"),
    caseOf(4, "stale-fact"),
    caseOf(5, "control"),
    caseOf(6, "control"),
  ];
  const results = Object.fromEntries(
    cases.map((c, i) => [
      c.caseId,
      i === 3
        ? { rederive: "pass", explanation: "pass" }
        : i === 5
          ? { rederive: "pass", explanation: "pass" }
          : { rederive: "hold" },
    ]),
  ) as never;

  it("候補ごと_測った指標は同じで_目標を満たしたかだけが変わる", () => {
    const candidates = ["0.7/0.0/0.5", "0.9/0.8/0.2"].map((t) => parseTargets(t) ?? ({} as never));
    const { observed, rows } = sweep(cases, results, candidates);
    expect(observed.detectionOverall.rate).toBe(0.75);
    expect(observed.falsePositive.rate).toBe(0.5);
    expect(rows.map((r) => r.meetsTargets)).toEqual([true, false]);
    expect(rows[1]?.belowTarget).toContain("detectionOverall");
    expect(rows[1]?.belowTarget).toContain("falsePositive");
    expect(rows[0]?.belowTarget).toEqual([]);
    expect(rows[1]?.belowTarget).toContain("detection:stale-fact");
  });

  it("保留の件数_再導出か解説の確認で保留にした件数を数える", () => {
    expect(holdCount(cases, results)).toBe(4);
  });
});

describe("台帳", () => {
  it("記録がまだない_空として読む", () => {
    expect(readTuning("/nonexistent/tuning.json")).toEqual([]);
    expect(readGate("/nonexistent/eval-gate.json")).toEqual([]);
  });

  it("根拠が欠ける記録や壊れた台帳_読むときに失敗にする", () => {
    const root = setupDraftRoot();
    const path = gatePath(root, baseConfig.recordsDir);
    mkdirSync(resolve(root, baseConfig.recordsDir), { recursive: true });
    writeFileSync(path, JSON.stringify({ records: [{ at: "2026-11-23", role: "verifier" }] }));
    expect(() => readGate(path)).toThrow(RecordsError);
    writeFileSync(tuningPath(root, baseConfig.recordsDir), "{ 壊れた");
    expect(() => readTuning(tuningPath(root, baseConfig.recordsDir))).toThrow(RecordsError);
  });

  it("記録を足す_前の記録を消さず末尾に足す", () => {
    const root = setupDraftRoot();
    const path = gatePath(root, baseConfig.recordsDir);
    const record = (at: string): GateRecord => ({
      at,
      role: "verifier",
      subjectHash: sha256(`${HASH}\n${HASH}`),
      agent: { role: "question-verifier", model: "m", definitionHash: HASH },
      settingsHash: HASH,
      reports: [{ examCode: "AWS-AIB-C01", datasetHash: HASH, cases: 4 }],
    });
    appendRecord(path, [], record("2026-11-01"));
    appendRecord(path, readGate(path), record("2026-11-02"));
    expect(readGate(path).map((r) => r.at)).toEqual(["2026-11-01", "2026-11-02"]);
  });
});

describe("評価の対象のハッシュ", () => {
  it("キーの並びが違う同じ内容_同じ文字列になる", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(canonicalJson({ a: 1 })).not.toBe(canonicalJson({ a: 2 }));
  });

  it("設定_しきい値を除き評価に関わる節だけを対象にする", () => {
    const verifier = JSON.stringify(settingsOf("verifier", baseConfig));
    expect(verifier).not.toContain("detectionOverall");
    expect(verifier).toContain("maxAttempts");
    const judge = JSON.stringify(settingsOf("judge", baseConfig));
    expect(judge).not.toContain("falsePositiveMax");
  });

  it("役の定義かしきい値以外の設定を変える_ハッシュが変わり_しきい値だけでは変わらない", () => {
    const root = setupDraftRoot();
    const before = subjectOf("verifier", root, baseConfig);
    const targetsOnly: Config = {
      ...baseConfig,
      eval: { ...baseConfig.eval, targets: { ...baseConfig.eval.targets, detectionOverall: 0.5 } },
    };
    expect(subjectOf("verifier", root, targetsOnly).subjectHash).toBe(before.subjectHash);
    const verifyChanged: Config = { ...baseConfig, verify: { ...baseConfig.verify, maxAttempts: 9 } };
    expect(subjectOf("verifier", root, verifyChanged).subjectHash).not.toBe(before.subjectHash);
    const definition = join(root, ".claude/agents/question-verifier.md");
    writeFileSync(definition, `${readFileSync(definition, "utf8")}\n追記した指示\n`);
    expect(subjectOf("verifier", root, baseConfig).subjectHash).not.toBe(before.subjectHash);
  });
});

describe("評価の関門", () => {
  const output = () => {
    const lines: string[] = [];
    return { lines, sink: { out: (t: string) => lines.push(t), err: (t: string) => lines.push(t) } };
  };
  const options = (root: string, o: Partial<Parameters<typeof runEvalGate>[0]> = {}) => {
    const { lines, sink } = output();
    return {
      lines,
      opts: {
        config: baseConfig,
        rootDir: root,
        record: false,
        role: undefined,
        dryRun: false,
        output: sink,
        today: () => "2026-11-23",
        ...o,
      },
    };
  };
  const writeReport = (root: string, dir: string, examCode: string, definitionHash: string, meets: boolean) => {
    const path = join(root, baseConfig.workDir, dir, examCode.toLowerCase());
    mkdirSync(path, { recursive: true });
    writeFileSync(
      join(path, "report.json"),
      JSON.stringify({
        examCode,
        agent: { definitionHash },
        dataset: { hash: HASH, cases: 8 },
        targets: dir === "eval" ? baseConfig.eval.targets : baseConfig.judge.eval.targets,
        metrics: { meetsTargets: meets },
      }),
    );
  };

  it("台帳に記録がない_検査は通る", () => {
    const root = setupDraftRoot();
    const { opts } = options(root);
    expect(runEvalGate(opts)).toBe(EXIT.ok);
  });

  it("合格の記録を作る_そのあと検査が通り_役の定義を変えると検査が失敗する", () => {
    const root = setupDraftRoot();
    const subject = subjectOf("verifier", root, baseConfig);
    writeReport(root, "eval", "AWS-AIB-C01", subject.agent.definitionHash, true);
    const recorded = options(root, { record: true, role: "verifier" });
    expect(runEvalGate(recorded.opts)).toBe(EXIT.ok);
    expect(readGate(gatePath(root, baseConfig.recordsDir))).toHaveLength(1);
    expect(runEvalGate(options(root).opts)).toBe(EXIT.ok);

    const definition = join(root, ".claude/agents/question-verifier.md");
    writeFileSync(definition, `${readFileSync(definition, "utf8")}\n変更した指示\n`);
    const failed = options(root);
    expect(runEvalGate(failed.opts)).toBe(EXIT.checkFailed);
    expect(failed.lines.join("")).toContain("verifier: 評価の対象");
    // 判定役の記録はないので、判定役の行は失敗にしない
    expect(failed.lines.join("")).toContain("judge: 記録なし");
  });

  it("設定の評価に関わる値を変える_合格の記録と違うので検査が失敗する", () => {
    const root = setupDraftRoot();
    const subject = subjectOf("verifier", root, baseConfig);
    writeReport(root, "eval", "AWS-AIB-C01", subject.agent.definitionHash, true);
    expect(runEvalGate(options(root, { record: true, role: "verifier" }).opts)).toBe(EXIT.ok);
    const changed: Config = { ...baseConfig, verify: { ...baseConfig.verify, maxAttempts: 9 } };
    expect(checkGate(changed, root, readGate(gatePath(root, baseConfig.recordsDir)))).toHaveLength(1);
  });

  it("目標を下回る評価_合格の記録を作らず失敗する", () => {
    const root = setupDraftRoot();
    const subject = subjectOf("verifier", root, baseConfig);
    writeReport(root, "eval", "AWS-AIB-C01", subject.agent.definitionHash, false);
    const { opts } = options(root, { record: true, role: "verifier" });
    expect(runEvalGate(opts)).toBe(EXIT.checkFailed);
    expect(readGate(gatePath(root, baseConfig.recordsDir))).toEqual([]);
  });

  it("古い定義のレポートだけ_現在の対象の根拠にならず失敗する", () => {
    const root = setupDraftRoot();
    writeReport(root, "eval", "AWS-AIB-C01", "b".repeat(64), true);
    expect(runEvalGate(options(root, { record: true, role: "verifier" }).opts)).toBe(EXIT.checkFailed);
  });

  it("レポートの目標が設定の目標と違う_目標を変えたあとは評価を流し直すまで記録しない", () => {
    const root = setupDraftRoot();
    const subject = subjectOf("verifier", root, baseConfig);
    writeReport(root, "eval", "AWS-AIB-C01", subject.agent.definitionHash, true);
    const stricter: Config = {
      ...baseConfig,
      eval: { ...baseConfig.eval, targets: { ...baseConfig.eval.targets, detectionOverall: 0.99 } },
    };
    const { opts } = options(root, { record: true, role: "verifier", config: stricter });
    expect(runEvalGate(opts)).toBe(EXIT.checkFailed);
    expect(readGate(gatePath(root, baseConfig.recordsDir))).toEqual([]);
  });

  it("台帳の記録_対象のハッシュと役の対応が合わないと読むときに失敗にする", () => {
    const root = setupDraftRoot();
    mkdirSync(resolve(root, baseConfig.recordsDir), { recursive: true });
    const record = {
      at: "2026-11-23",
      role: "verifier",
      subjectHash: HASH,
      agent: { role: "question-verifier", model: "m", definitionHash: HASH },
      settingsHash: HASH,
      reports: [{ examCode: "AWS-AIB-C01", datasetHash: HASH, cases: 4 }],
    };
    const path = gatePath(root, baseConfig.recordsDir);
    writeFileSync(path, JSON.stringify({ records: [record] }));
    expect(() => readGate(path)).toThrow(RecordsError);
    const good = { ...record, subjectHash: sha256(`${HASH}\n${HASH}`), role: "judge" };
    writeFileSync(path, JSON.stringify({ records: [good] }));
    expect(() => readGate(path)).toThrow(RecordsError);
  });

  it("役の指定がない記録_入力の誤りにする", () => {
    const root = setupDraftRoot();
    expect(runEvalGate(options(root, { record: true }).opts)).toBe(EXIT.inputError);
  });

  it("dry-run_台帳を書かない", () => {
    const root = setupDraftRoot();
    const subject = subjectOf("verifier", root, baseConfig);
    writeReport(root, "eval", "AWS-AIB-C01", subject.agent.definitionHash, true);
    expect(runEvalGate(options(root, { record: true, role: "verifier", dryRun: true }).opts)).toBe(EXIT.ok);
    expect(readGate(gatePath(root, baseConfig.recordsDir))).toEqual([]);
  });

  it("壊れた台帳_検査が失敗する", () => {
    const root = setupDraftRoot();
    mkdirSync(resolve(root, baseConfig.recordsDir), { recursive: true });
    writeFileSync(gatePath(root, baseConfig.recordsDir), "壊れた");
    expect(runEvalGate(options(root).opts)).toBe(EXIT.checkFailed);
  });
});

describe("コマンド", () => {
  it("eval-gate_オプションと値を受け付け_役の値は eval-gate だけが受ける", async () => {
    const root = setupDraftRoot();
    expect((await runMain(root, ["eval-gate"])).code).toBe(EXIT.ok);
    expect((await runMain(root, ["eval-gate", "--record", "--role=judge"])).code).toBe(EXIT.checkFailed);
    expect((await runMain(root, ["eval", "AWS-AIB-C01", "--role=judge"])).code).toBe(EXIT.inputError);
    expect((await runMain(root, ["eval-sweep", "AWS-AIB-C01", "--role=judge"])).code).toBe(EXIT.inputError);
  });

  it("値つきオプション_空の値と重複と記録のない理由や役は入力の誤りにする", async () => {
    const root = setupDraftRoot();
    expect((await runMain(root, ["eval-gate", "--role="])).code).toBe(EXIT.inputError);
    expect((await runMain(root, ["eval-gate", "--role=judge"])).code).toBe(EXIT.inputError);
    expect((await runMain(root, ["eval-gate", "--record", "--role=judge", "--role=verifier"])).code).toBe(
      EXIT.inputError,
    );
    expect((await runMain(root, ["eval-sweep", "AWS-AIB-C01", "--reason=理由", "--targets=0.9/0.8/0.2"])).code).toBe(
      EXIT.inputError,
    );
    expect((await runMain(root, ["eval-sweep", "AWS-AIB-C01", "--targets="])).code).toBe(EXIT.inputError);
  });

  it("eval-sweep_候補の形が違うと入力の誤りにし_評価用のデータがないと入力の誤りにする", async () => {
    const root = setupDraftRoot();
    expect((await runMain(root, ["eval-sweep", "AWS-AIB-C01", "--targets=1/2"])).code).toBe(EXIT.inputError);
    expect((await runMain(root, ["eval-sweep", "AWS-AIB-C01"])).code).toBe(EXIT.inputError);
    expect((await runMain(root, ["eval-sweep", "AWS-AIB-C01", "--targets=0.9/0.8/0.2"])).code).toBe(EXIT.inputError);
  });
});

describe("リポジトリの台帳", () => {
  const config = loadConfig(resolve(repoRoot, "packages/pipeline/pipeline.config.json"), {});

  it("設定のしきい値_台帳の最新の記録と一致している(記録がなければ一致とみなす)", () => {
    expect(checkTuningConsistency(config, repoRoot)).toEqual([]);
  });

  it("評価の対象_台帳の最新の合格の記録と同じである(ネットワークを使わない)", () => {
    const records = readGate(gatePath(repoRoot, config.recordsDir));
    expect(checkGate(config, repoRoot, records)).toEqual([]);
  });
});
