/**
 * 全件のテスト(npm run test:all)の計画。ルートの scripts と、すべてのワークスペースのテストを、途中で失敗しても止めずに流す。
 * `npm test` は、途中で失敗すると、後ろのワークスペースのテストが流れない。失敗した 1 件だけを流し直して通っても、後ろの結果は分からない。
 * 判定は副作用のない関数にして単体テストする(実行は scripts/test-all.ts)。
 */
import { buildStages, type Stage } from "./verify-plan.ts";

export interface StageResult {
  name: string;
  ms: number;
  ok: boolean;
}

/** 流す段階。`npm run verify` のテストの段階(scripts、data-schema、各ワークスペース)を、変更に関係なくすべて選ぶ。 */
export function buildTestStages(): Stage[] {
  return buildStages({ app: true, infra: true, pipeline: true }).filter((s) => s.name.startsWith("test("));
}

/** すべての段階を順に流す。失敗しても、次の段階を流す。run は、段階が成功したら true を返す。 */
export function runAllStages(stages: Stage[], run: (stage: Stage) => boolean, now: () => number): StageResult[] {
  return stages.map((stage) => {
    const start = now();
    const ok = run(stage);
    return { name: stage.name, ms: now() - start, ok };
  });
}

/** 結果を、表示用の文字列にする。失敗した段階は、すべて挙げる。 */
export function formatSummary(results: StageResult[]): string {
  const rows = results.map((r) => `${r.ok ? "成功" : "失敗"}  ${(r.ms / 1000).toFixed(1).padStart(6)} 秒  ${r.name}`);
  const failed = results.filter((r) => !r.ok).map((r) => r.name);
  return `${rows.join("\n")}\n${failed.length > 0 ? `失敗した段階: ${failed.join(", ")}` : "すべて成功"}\n`;
}
