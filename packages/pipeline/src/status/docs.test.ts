import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { COMMANDS } from "../commands.ts";
import { KNOWN_FLAGS } from "../main.ts";
import { agentDefinitionPath, PIPELINE_ROLES } from "../shared/agents.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const config = JSON.parse(readFileSync(resolve(import.meta.dirname, "../../pipeline.config.json"), "utf8"));

const SKILL = resolve(repoRoot, ".claude/skills/pipeline-run/SKILL.md");
const DOCS = [
  SKILL,
  resolve(repoRoot, "docs/question-production.md"),
  resolve(repoRoot, "packages/pipeline/README.md"),
];

/** 設定の項目の名前(`facts.maxAttempts` のようにドットでつないだもの)を、すべて集める */
function configPaths(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  return Object.entries(value).flatMap(([key, child]) => [
    `${prefix}${key}`,
    ...configPaths(child, `${prefix}${key}.`),
  ]);
}

const names = new Set(COMMANDS.map((c) => c.name));
const paths = new Set(configPaths(config));
const topLevel = new Set(Object.keys(config));

describe("スキルと文書に書いた名前", () => {
  it.each(DOCS)("%s_コマンド名とオプションが、実装にある", (file) => {
    const text = readFileSync(file, "utf8");
    // `collect <資格コード> --import-guide` と、`npm run pipeline -- status <試験コード>` の形
    const uses = [...text.matchAll(/(?:pipeline -- |`)(collect|facts|plan|draft|verify|status|export)\b[^`\n]*/g)];
    expect(uses.length).toBeGreaterThan(0);
    for (const m of uses) {
      expect(names.has(m[1] as string), `${file}: ${m[1]}`).toBe(true);
      for (const flag of m[0].matchAll(/ (--[a-z-]+)/g)) {
        const name = flag[1] as string;
        expect(KNOWN_FLAGS.includes(name), `${file}: ${m[1]} ${name}`).toBe(true);
      }
    }
  });

  it.each(DOCS)("%s_設定の項目の名前が、設定にある", (file) => {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/`([a-z][A-Za-z]*(?:\.[A-Za-z]+)*)`/g)) {
      const token = m[1] as string;
      const dotted = token.includes(".") && topLevel.has(token.split(".")[0] as string);
      const camel = /^[a-z]+[A-Z][A-Za-z]*$/.test(token) && !token.includes(".") && /^(max|retention|per)/.test(token);
      if (dotted || camel) expect(paths.has(token), `${file}: ${token}`).toBe(true);
    }
  });

  it("スキル_役の名前に対応する定義があり、人が指示したときだけ動き、コミット・push・PR をしないと書いている", () => {
    const text = readFileSync(SKILL, "utf8");
    for (const role of PIPELINE_ROLES) {
      expect(text, role).toContain(role);
      expect(existsSync(agentDefinitionPath(repoRoot, role)), role).toBe(true);
    }
    expect(text).toContain("disable-model-invocation: true");
    expect(text).toContain("コミット、push、PR の作成");
    expect(text).toContain("人の確認で止まる");
    expect(text).toContain("済んだ依頼は出し直されない");
    expect(text).toContain("止まる条件");
  });

  it("スキルに書いた報告の見出し_実装が出す種類と一致する", () => {
    const log = readFileSync(resolve(repoRoot, "packages/pipeline/src/log.ts"), "utf8");
    const text = readFileSync(SKILL, "utf8");
    for (const kind of ["再試行の上限", "件数の上限", "検証の節なし", "エージェントの定義の誤り"]) {
      expect(text, kind).toContain(kind);
      expect(log, kind).toContain(`"${kind}"`);
    }
  });
});
