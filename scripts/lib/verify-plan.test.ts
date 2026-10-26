import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  ALL_PATTERN,
  APP_PATTERN,
  buildStages,
  CHECK_SCRIPTS,
  E2E_EXCLUDE_PATTERN,
  formatResult,
  INFRA_PATTERN,
  PIPELINE_PATTERN,
  POST_BUILD_CHECKS,
  selectWorkspaces,
} from "./verify-plan.ts";

describe("selectWorkspaces", () => {
  it("変更が分からない_すべて選ぶ", () => {
    expect(selectWorkspaces(null)).toEqual({ app: true, infra: true, pipeline: true });
  });

  it("appだけの変更_appだけ選ぶ", () => {
    expect(selectWorkspaces(["packages/app/src/lib/quiz.ts"])).toEqual({ app: true, infra: false, pipeline: false });
  });

  it("dataの変更_appを選ぶ", () => {
    expect(selectWorkspaces(["data/release-notes.json"])).toEqual({ app: true, infra: false, pipeline: false });
  });

  it("infraとpipelineの変更_それぞれ選ぶ", () => {
    expect(selectWorkspaces(["packages/infra/lib/web-stack.ts", "packages/pipeline/src/main.ts"])).toEqual({
      app: false,
      infra: true,
      pipeline: true,
    });
  });

  it.each([["package.json"], [".github/workflows/ci.yml"], ["scripts/verify.ts"], ["packages/data-schema/src/a.ts"]])(
    "契約とルートの設定とscriptsとCIの変更_すべて選ぶ(%s)",
    (file) => {
      expect(selectWorkspaces([file])).toEqual({ app: true, infra: true, pipeline: true });
    },
  );

  it("docsの変更_pipelineだけ選ぶ(pipelineのテストがdocsの文書を読む)", () => {
    expect(selectWorkspaces(["docs/known-issues.md"])).toEqual({ app: false, infra: false, pipeline: true });
  });

  it("スキルの文書だけの変更_どれも選ばない", () => {
    expect(selectWorkspaces([".claude/skills/dev-pr/SKILL.md"])).toEqual({ app: false, infra: false, pipeline: false });
  });

  it.each([[".claude/agents/question-drafter.md"], ["data/exams.json"]])(
    "pipelineのテストが読むファイルの変更_pipelineを選ぶ(%s)",
    (file) => {
      expect(selectWorkspaces([file]).pipeline).toBe(true);
    },
  );
});

describe("CIの指定との一致", () => {
  const ci = readFileSync(fileURLToPath(new URL("../../.github/workflows/ci.yml", import.meta.url)), "utf8");

  it("変更のパスの指定_CIのchangesジョブと同じ文字列である", () => {
    expect(ci).toContain(`matches '${ALL_PATTERN}'`);
    expect(ci).toContain(`flag '${APP_PATTERN}'`);
    expect(ci).toContain(`flag_e2e '${APP_PATTERN}'`);
    expect(ci).toContain(`grep -v '${E2E_EXCLUDE_PATTERN}'`);
    expect(ci).toContain(`flag '${INFRA_PATTERN}'`);
    expect(ci).toContain(`flag '${PIPELINE_PATTERN}'`);
  });

  it("checkの検査_CIが実行するnpmスクリプト(checkジョブと、appジョブのbuild後の検査)と集合として一致する", () => {
    const inCi = [...ci.matchAll(/^\s*- run: npm run (check:[a-z-]+)\s*$/gm)].map((m) => m[1]).sort();
    expect(inCi).toEqual([...CHECK_SCRIPTS, ...POST_BUILD_CHECKS].sort());
  });
});

describe("buildStages", () => {
  const names = (s: ReturnType<typeof buildStages>) => s.map((x) => x.name);

  it("何も選ばない_共通の段階とscriptsとdata-schemaのテストだけを順に返す", () => {
    expect(names(buildStages({ app: false, infra: false, pipeline: false }))).toEqual([
      "lint",
      "typecheck",
      ...CHECK_SCRIPTS,
      "validate:data",
      "test(scripts)",
      "test(data-schema)",
    ]);
  });

  it("appを選ぶ_appのテストとbuildを加える", () => {
    const stages = names(buildStages({ app: true, infra: false, pipeline: false }));
    expect(stages.slice(-4)).toEqual(["test(data-schema)", "test(app)", "build(app)", ...POST_BUILD_CHECKS]);
  });

  it("infraとpipelineを選ぶ_テストとbuildを加える", () => {
    const stages = names(buildStages({ app: false, infra: true, pipeline: true }));
    expect(stages.slice(-4)).toEqual(["test(infra)", "test(pipeline)", "build(infra)", "build(pipeline)"]);
  });

  it("E2E_含めない", () => {
    expect(names(buildStages({ app: true, infra: true, pipeline: true })).join(" ")).not.toContain("e2e");
  });
});

describe("formatResult", () => {
  it("すべて成功_時間と成功を表示する", () => {
    const text = formatResult([{ name: "lint", ms: 1500, ok: true }]);
    expect(text).toContain("成功");
    expect(text).toContain("1.5 秒  lint");
    expect(text).toContain("すべて成功");
  });

  it("失敗がある_失敗した段階の名前を示す", () => {
    const text = formatResult([
      { name: "lint", ms: 100, ok: true },
      { name: "typecheck", ms: 200, ok: false },
    ]);
    expect(text).toContain("失敗した段階: typecheck");
  });
});
