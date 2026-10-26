import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PIPELINE_ROLES, readAgentStamp } from "./agents.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const ADR = resolve(repoRoot, "docs/app/adr/0021-pipeline-judge-role.md");

/** ADR の表のモデルの表記と、エージェントの定義の完全な ID の対応 */
const MODEL_IDS: Record<string, string> = {
  "Haiku 5.5": "claude-haiku-5-5",
  "Sonnet 5.5": "claude-sonnet-5-5",
  "Opus 5.5": "claude-opus-5-5",
};

/** ADR の表から、エージェント名 → モデルの表記 */
function adrModels(): Map<string, string> {
  const rows = readFileSync(ADR, "utf8")
    .split("\n")
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|").map((cell) => cell.trim()));
  const out = new Map<string, string>();
  for (const cells of rows) {
    const agent = /^`([a-z-]+)`$/.exec(cells[2] ?? "")?.[1];
    if (agent !== undefined) out.set(agent, cells[3] ?? "");
  }
  return out;
}

describe("パイプラインの役のモデル", () => {
  it("すべての役が ADR 0021 の表にあり_定義の model: と表のモデルが一致する", () => {
    const table = adrModels();
    expect([...table.keys()].sort()).toEqual([...PIPELINE_ROLES].sort());
    for (const role of PIPELINE_ROLES) {
      const label = table.get(role) as string;
      expect(MODEL_IDS[label], `${role}: 表のモデルの表記`).toBeDefined();
      expect(readAgentStamp(repoRoot, role).model, role).toBe(MODEL_IDS[label]);
    }
  });

  it("検証役と判定役のモデル_下書きの役と異なり_判定役はブラッシュアップ役とも異なる", () => {
    const drafter = readAgentStamp(repoRoot, "question-drafter").model;
    expect(readAgentStamp(repoRoot, "question-verifier").model).not.toBe(drafter);
    expect(readAgentStamp(repoRoot, "question-judge").model).not.toBe(drafter);
    expect(readAgentStamp(repoRoot, "question-judge").model).not.toBe(
      readAgentStamp(repoRoot, "question-reviser").model,
    );
  });

  it("定義の model:_モデルの別名ではなく、完全な ID で固定している", () => {
    for (const role of PIPELINE_ROLES) {
      expect(readAgentStamp(repoRoot, role).model, role).toMatch(/^claude-[a-z]+-\d+(?:-\d+)*$/);
    }
  });
});
