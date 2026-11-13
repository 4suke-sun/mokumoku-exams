/**
 * 手元の検査(npm run verify)の計画。変更したパスから、テストと build の対象のワークスペースを選ぶ。
 * 選び方は CI の `changes` ジョブ(.github/workflows/ci.yml)と同じ。指定の文字列が CI とずれないことは、テストで確かめる。
 * 判定は副作用のない関数にして単体テストする(実行は scripts/verify.ts)。
 */

// CI の `changes` ジョブの `matches '…'` と同じ指定(拡張正規表現)
export const ALL_PATTERN = String.raw`^[^/]+$|^\.github/|^scripts/|^packages/data-schema/`;
export const APP_PATTERN = "^packages/app/|^data/";
export const INFRA_PATTERN = "^packages/infra/";
// pipeline のテストは、docs/ の文書、.claude/agents/ の定義、data/exams.json を読む
export const PIPELINE_PATTERN = String.raw`^packages/pipeline/|^docs/|^\.claude/agents/|^data/exams\.json$`;
// e2e だけは、リリースノートだけの変更では動かさない(verify は e2e を実行しない。CI との一致を守るために持つ)
export const E2E_EXCLUDE_PATTERN = String.raw`^data/release-notes\.json$`;

export interface Selection {
  app: boolean;
  infra: boolean;
  pipeline: boolean;
}

/**
 * 変更したパスから、対象を選ぶ。変更が分からないとき(null)と、契約・ルートの設定・scripts・CI の定義が変わったときは、すべて選ぶ。
 */
export function selectWorkspaces(changed: string[] | null): Selection {
  if (changed === null || changed.some((f) => new RegExp(ALL_PATTERN).test(f))) {
    return { app: true, infra: true, pipeline: true };
  }
  const has = (pattern: string) => changed.some((f) => new RegExp(pattern).test(f));
  return { app: has(APP_PATTERN), infra: has(INFRA_PATTERN), pipeline: has(PIPELINE_PATTERN) };
}

export interface Stage {
  name: string;
  command: string;
  args: string[];
}

const npm = (name: string, args: string[]): Stage => ({ name, command: "npm", args });

/** CI の `check` ジョブが実行する検査(npm のスクリプト名) */
export const CHECK_SCRIPTS = [
  "check:release-notes",
  "check:lessons",
  "check:test-titles",
  "check:docs",
  "check:env",
  "check:boundary",
  "check:retired-ids",
  "check:ui-patterns",
];

/** CI の `app` ジョブが、build のあとに実行する検査(verify でも、build のあとに実行する) */
export const POST_BUILD_CHECKS = ["check:unpublished-bundle"];

const WORKSPACE_NAMES: Record<keyof Selection, string> = {
  app: "@mokumoku-exams/app",
  infra: "@mokumoku-exams/infra",
  pipeline: "@mokumoku-exams/pipeline",
};

/** 実行する段階の一覧。順に実行し、失敗した段階で止める。 */
export function buildStages(selection: Selection): Stage[] {
  const selected = (Object.keys(WORKSPACE_NAMES) as (keyof Selection)[]).filter((k) => selection[k]);
  const stages: Stage[] = [
    npm("lint", ["run", "lint"]),
    npm("typecheck", ["run", "typecheck"]),
    ...CHECK_SCRIPTS.map((name) => npm(name, ["run", name])),
    npm("validate:data", ["run", "validate:data"]),
    // scripts と共有する契約(data-schema)のテストは、常に含める(CI の check ジョブと同じ)
    { name: "test(scripts)", command: "npx", args: ["vitest", "run"] },
    npm("test(data-schema)", ["test", "-w", "@mokumoku-exams/data-schema"]),
    ...selected.map((k) => npm(`test(${k})`, ["test", "-w", WORKSPACE_NAMES[k]])),
    ...selected.map((k) => npm(`build(${k})`, ["run", "build", "-w", WORKSPACE_NAMES[k], "--if-present"])),
    // 非公開の問題が、アプリのビルド成果物に含まれないこと(CI の app ジョブと同じ。先に build が要る)
    ...(selection.app ? POST_BUILD_CHECKS.map((name) => npm(name, ["run", name])) : []),
  ];
  return stages;
}

/** 失敗した段階までの結果を、表示用の文字列にする。 */
export function formatResult(results: { name: string; ms: number; ok: boolean }[]): string {
  const rows = results.map((r) => `${r.ok ? "成功" : "失敗"}  ${(r.ms / 1000).toFixed(1).padStart(6)} 秒  ${r.name}`);
  const failed = results.find((r) => !r.ok);
  return `${rows.join("\n")}\n${failed ? `失敗した段階: ${failed.name}` : "すべて成功"}\n`;
}
