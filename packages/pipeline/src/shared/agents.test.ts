import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  AgentDefinitionError,
  agentDefinitionPath,
  PIPELINE_ROLES,
  parseAgentDefinition,
  readAgentStamp,
  sameDefinition,
} from "./agents.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");

const definition = (model: string, description: string, body: string) =>
  `---\nname: fact-extractor\ndescription: ${description}\nmodel: ${model}\ntools: Read, Write\n---\n\n${body}\n`;

describe("エージェントの定義", () => {
  it("定義を読む_モデルの完全な ID と、64 桁のハッシュを返す", () => {
    const stamp = parseAgentDefinition("fact-extractor", definition("claude-haiku-5-5", "説明", "指示"));
    expect(stamp).toMatchObject({ role: "fact-extractor", model: "claude-haiku-5-5" });
    expect(stamp.definitionHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("説明だけを変えた_ハッシュは変わらない", () => {
    const a = parseAgentDefinition("fact-extractor", definition("claude-haiku-5-5", "説明", "指示"));
    const b = parseAgentDefinition("fact-extractor", definition("claude-haiku-5-5", "言い直した説明", "指示"));
    expect(b.definitionHash).toBe(a.definitionHash);
  });

  it("指示の本文を変えた_ハッシュが変わる", () => {
    const a = parseAgentDefinition("fact-extractor", definition("claude-haiku-5-5", "説明", "指示"));
    const b = parseAgentDefinition("fact-extractor", definition("claude-haiku-5-5", "説明", "指示を足した"));
    expect(b.definitionHash).not.toBe(a.definitionHash);
  });

  it("モデルを変えた_ハッシュが変わる", () => {
    const a = parseAgentDefinition("fact-extractor", definition("claude-haiku-5-5", "説明", "指示"));
    const b = parseAgentDefinition("fact-extractor", definition("claude-sonnet-5-5", "説明", "指示"));
    expect(b.model).toBe("claude-sonnet-5-5");
    expect(b.definitionHash).not.toBe(a.definitionHash);
  });

  it("行末の空白と改行コードの違い_ハッシュは変わらない", () => {
    const a = parseAgentDefinition("fact-extractor", definition("claude-haiku-5-5", "説明", "指示"));
    const b = parseAgentDefinition(
      "fact-extractor",
      definition("claude-haiku-5-5", "説明", "指示  ").replace(/\n/g, "\r\n"),
    );
    expect(b.definitionHash).toBe(a.definitionHash);
  });

  it("モデルの指定がない・前置きがない_定義の誤りになる", () => {
    expect(() => parseAgentDefinition("fact-extractor", "---\nname: x\n---\n指示")).toThrow(AgentDefinitionError);
    expect(() => parseAgentDefinition("fact-extractor", "指示だけ")).toThrow(AgentDefinitionError);
  });

  it("リポジトリの役の定義_すべての役で読め、モデルは完全な ID になっている", () => {
    for (const role of PIPELINE_ROLES) {
      expect(readAgentStamp(repoRoot, role).model, agentDefinitionPath(repoRoot, role)).toMatch(/^claude-/);
    }
  });

  it("記録がない古い結果_同じ定義として扱い、ハッシュが違えば違う定義として扱う", () => {
    const current = parseAgentDefinition("fact-extractor", definition("claude-haiku-5-5", "説明", "指示"));
    expect(sameDefinition(undefined, current)).toBe(true);
    expect(sameDefinition(current, current)).toBe(true);
    expect(sameDefinition({ ...current, definitionHash: "0".repeat(64) }, current)).toBe(false);
  });
});
