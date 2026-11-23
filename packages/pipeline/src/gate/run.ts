import { existsSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { z } from "zod";
import type { Config } from "../config.ts";
import { EXIT, type ExitCode } from "../exit-codes.ts";
import { type Output, report } from "../log.ts";
import { appendRecord, type GateRecord, gatePath, RecordsError, readGate } from "../records/store.ts";
import { AgentDefinitionError } from "../shared/agents.ts";
import { readJsonFile } from "../shared/request-flow.ts";
import { GATE_ROLES, type GateRole, REPORT_DIR, subjectOf } from "./subjects.ts";

/**
 * eval-gate コマンド: プロンプト・モデル・設定を変えたら、評価に合格した記録を台帳に足す義務の関門。手動で回す。
 * - eval-gate                      検査: 評価の対象のハッシュが、台帳の最新の合格の記録と違うとき失敗する。ネットワークもモデルも使わない(CI で回る)
 * - eval-gate --record --role=<verifier|judge>   記録: 現在の対象で評価した合格のレポートを、台帳に足す。目標を下回るレポートがあるときは、記録を作らず失敗する
 * 台帳に、その役の記録がまだないときは、検査は通る(最初の評価の記録で、基準ができる)。
 */

export interface GateOptions {
  config: Config;
  rootDir: string;
  record: boolean;
  role: string | undefined;
  dryRun: boolean;
  output: Output;
  today(): string;
}

const ReportSchema = z.object({
  examCode: z.string().min(1),
  agent: z.object({ definitionHash: z.string() }),
  dataset: z.object({ hash: z.string(), cases: z.number().int() }),
  criteriaHash: z.string().optional(),
  targets: z.object({ detectionOverall: z.number(), detectionPerKind: z.number(), falsePositiveMax: z.number() }),
  metrics: z.object({ meetsTargets: z.boolean() }),
});

/** 検査。失敗の理由(場所と種類だけ)の一覧。 */
export function checkGate(
  config: Config,
  rootDir: string,
  records: GateRecord[],
): { role: GateRole; message: string }[] {
  const problems: { role: GateRole; message: string }[] = [];
  for (const role of GATE_ROLES) {
    const latest = records.filter((r) => r.role === role).at(-1);
    if (latest === undefined) continue;
    if (subjectOf(role, rootDir, config).subjectHash !== latest.subjectHash) {
      problems.push({
        role,
        message: "評価の対象(役の定義か設定)が、最後に合格した記録と違う(評価を流して合格の記録を足す)",
      });
    }
  }
  return problems;
}

export function runEvalGate(options: GateOptions): ExitCode {
  const { config, rootDir, output } = options;
  const path = gatePath(rootDir, config.recordsDir);
  let records: GateRecord[];
  try {
    records = readGate(path);
  } catch (error) {
    if (!(error instanceof RecordsError)) throw error;
    report(output, "評価の記録の誤り", relative(rootDir, error.file));
    return EXIT.checkFailed;
  }
  try {
    if (!options.record) {
      const problems = checkGate(config, rootDir, records);
      for (const role of GATE_ROLES) {
        const has = records.some((r) => r.role === role);
        const bad = problems.find((p) => p.role === role);
        report(
          output,
          "評価の関門",
          `${role}: ${bad ? bad.message : has ? "合格の記録と一致" : "記録なし(最初の評価で記録する)"}`,
        );
      }
      return problems.length === 0 ? EXIT.ok : EXIT.checkFailed;
    }
    return recordPass(options, path, records);
  } catch (error) {
    if (!(error instanceof AgentDefinitionError)) throw error;
    report(output, "エージェントの定義の誤り", error.role);
    return EXIT.checkFailed;
  }
}

function recordPass(options: GateOptions, path: string, records: GateRecord[]): ExitCode {
  const { config, rootDir, output } = options;
  if (options.role !== "verifier" && options.role !== "judge") {
    report(output, "入力の誤り", "--role は verifier か judge");
    return EXIT.inputError;
  }
  const role = options.role;
  const subject = subjectOf(role, rootDir, config);
  const dir = join(resolve(rootDir, config.workDir), REPORT_DIR[role]);
  const reports = existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory() && existsSync(join(dir, d.name, "report.json")))
        .flatMap((d) => {
          const parsed = ReportSchema.safeParse(readJsonFile(join(dir, d.name, "report.json")));
          return parsed.success ? [parsed.data] : [];
        })
    : [];
  // 現在の役の定義で評価したレポートだけを数える(古い定義のレポートは、現在の対象の根拠にならない)
  const current = reports.filter((r) => r.agent.definitionHash === subject.agent.definitionHash);
  if (current.length === 0) {
    report(output, "評価の関門", `${role}: 現在の定義で評価したレポートがない(評価を流す)`);
    return EXIT.checkFailed;
  }
  // レポートが測った時点の目標が、いまの設定の目標と同じものだけを数える(目標を変えたあとは、評価を流し直す)
  const nowTargets = role === "verifier" ? config.eval.targets : config.judge.eval.targets;
  const sameTargetsAsNow = (r: (typeof current)[number]) =>
    r.targets.detectionOverall === nowTargets.detectionOverall &&
    r.targets.detectionPerKind === nowTargets.detectionPerKind &&
    r.targets.falsePositiveMax === nowTargets.falsePositiveMax;
  const outdated = current.filter((r) => !sameTargetsAsNow(r));
  if (outdated.length > 0) {
    for (const r of outdated)
      report(output, "評価の関門", `${role}: ${r.examCode} のレポートの目標が、設定の目標と違う(評価を流し直す)`);
    return EXIT.checkFailed;
  }
  const failed = current.filter((r) => !r.metrics.meetsTargets);
  if (failed.length > 0) {
    // 基準を下回る評価では、合格の記録を作らない
    for (const r of failed)
      report(output, "評価の関門", `${role}: ${r.examCode} は目標を満たしていない(記録を作らない)`);
    return EXIT.checkFailed;
  }
  const entry: GateRecord = {
    at: options.today(),
    role,
    subjectHash: subject.subjectHash,
    agent: subject.agent,
    settingsHash: subject.settingsHash,
    reports: current.map((r) => ({
      examCode: r.examCode,
      datasetHash: r.dataset.hash,
      cases: r.dataset.cases,
      ...(r.criteriaHash === undefined ? {} : { criteriaHash: r.criteriaHash }),
    })),
  };
  if (options.dryRun) report(output, "書き込みをしない(dry-run)");
  else appendRecord(path, records, entry);
  report(output, "評価の関門", `${role}: 合格の記録を足した(${current.length} 件のレポート)`);
  return EXIT.ok;
}
