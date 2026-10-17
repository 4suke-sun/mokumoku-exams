import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { EXIT } from "../exit-codes.ts";
import { main } from "../main.ts";
import { planPath, readPlan } from "../plan/schema.ts";
import { installAgentDefinitions } from "./test-helpers.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8"));

/** 架空の準備中の資格。items で、パイプライン用の項目を足す */
function comingSoon(items: Record<string, unknown>) {
  return {
    examCode: "EX-LTR-XX",
    status: "coming-soon",
    vendor: "Example",
    name: "準備中の架空の資格",
    shortName: "準備中",
    ...items,
  };
}

const FULL = {
  edition: "L01",
  officialQuestionCount: 10,
  idPrefix: "LATER",
  domains: [
    { code: "domain1", name: "分野 1", weight: 0.6 },
    { code: "domain2", name: "分野 2", weight: 0.4 },
  ],
};

function setupRoot(exam: Record<string, unknown>) {
  const root = mkdtempSync(join(tmpdir(), "pipeline-exam-"));
  mkdirSync(join(root, "data"));
  const exams = JSON.parse(readFileSync(join(repoRoot, "data/exams.json"), "utf8"));
  writeFileSync(join(root, "data/exams.json"), JSON.stringify({ exams: [...exams.exams, exam] }));
  installAgentDefinitions(root);
  return root;
}

async function run(root: string, argv: string[]) {
  const configPath = join(root, "pipeline.config.json");
  writeFileSync(configPath, JSON.stringify({ ...config, maxItemsPerRun: 100 }));
  let out = "";
  let err = "";
  const code = await main({
    argv,
    env: {},
    output: {
      out: (t) => {
        out += t;
      },
      err: (t) => {
        err += t;
      },
    },
    configPath,
    rootDir: root,
  });
  return { code, out, err };
}

const CODE = "EX-LTR-XX";

describe("分野と本番の出題数を持つ準備中の資格", () => {
  it("出題計画_問題のファイルがなくても、既存を 0 件として、本番の出題数 × 倍率の目標を立てる", async () => {
    const root = setupRoot(comingSoon(FULL));
    const r = await run(root, ["plan", CODE]);
    expect(r.code).toBe(EXIT.ok);
    const plan = readPlan(planPath(join(root, config.workDir), CODE));
    expect(plan?.existingTotal).toBe(0);
    expect(plan?.targetTotal).toBe(FULL.officialQuestionCount * config.plan.targetMultiplier);
    expect(plan?.domains.map((d) => d.domain)).toEqual(["domain1", "domain2"]);
  });

  it("事実カード・下書き・検証_入力の誤りで止めない(分野と出題数を持つので受け付ける)", async () => {
    const root = setupRoot(comingSoon(FULL));
    await run(root, ["plan", CODE]);
    for (const argv of [
      ["facts", CODE],
      ["draft", CODE],
      ["verify", CODE],
      ["status", CODE],
    ]) {
      const r = await run(root, argv);
      expect(r.code, argv.join(" ")).not.toBe(EXIT.inputError);
      expect(r.err, argv.join(" ")).not.toContain("資格マスタに");
    }
  });

  it.each([
    ["分野がない", { ...FULL, domains: undefined }, ["資格マスタに分野がない"]],
    ["本番の出題数がない", { ...FULL, officialQuestionCount: undefined }, ["資格マスタに本番の出題数がない"]],
    ["分野も出題数もない", { edition: "L01" }, ["資格マスタに分野がない", "資格マスタに本番の出題数がない"]],
  ])("%s_出題計画と下書きは、足りない項目を示して入力の誤りで止まる", async (_, items, messages) => {
    const root = setupRoot(comingSoon(items));
    for (const argv of [
      ["plan", CODE],
      ["draft", CODE],
      ["verify", CODE],
    ]) {
      const r = await run(root, argv);
      expect(r.code, argv.join(" ")).toBe(EXIT.inputError);
      for (const m of messages) expect(r.err, argv.join(" ")).toContain(`入力の誤り: ${m}`);
      expect(r.err).not.toContain("公開中の資格ではない");
    }
  });

  it("分野を持たない準備中の資格_事実カードの依頼は、分野がないので何も依頼しない(止めない)", async () => {
    const root = setupRoot(comingSoon({}));
    const r = await run(root, ["facts", CODE]);
    expect(r.code).toBe(EXIT.ok);
    expect(r.out).toContain("依頼 0 件");
  });
});
