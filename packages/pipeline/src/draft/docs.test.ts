import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DISTRACTOR_CODES } from "./distractors.ts";
import { STYLE_RULES } from "./style.ts";
import { baseConfig } from "./test-helpers.ts";

const docsDir = resolve(import.meta.dirname, "../../../../docs");
const read = (name: string) => readFileSync(resolve(docsDir, name), "utf8");

const WEIGHT = { block: "止める", warn: "警告", hold: "保留" } as const;

/** 表の行 `| \`名前\` | 止める | … |` から、名前と重さを取り出す */
function ruleRows(text: string): { name: string; weight: string }[] {
  return [...text.matchAll(/^\| `([a-z0-9-]+)` \| (止める|警告|保留) \|/gm)].map((m) => ({
    name: m[1] as string,
    weight: m[2] as string,
  }));
}

describe("スタイルガイドと規則の一致", () => {
  const rows = ruleRows(read("question-style.md"));
  const expected = new Map<string, string>([
    ...STYLE_RULES.map((r) => [r.name, WEIGHT[r.severity]] as const),
    ...Object.entries(DISTRACTOR_CODES).map(([code, kind]) => [code, WEIGHT[kind]] as const),
  ]);

  it("すべての規則と誤答の検査のコードが_ガイドの表に同じ重さで載っている", () => {
    for (const [name, weight] of expected) {
      const row = rows.find((r) => r.name === name);
      expect(row, `ガイドに ${name} の行がない`).toBeDefined();
      expect(row?.weight, `${name} の重さ`).toBe(weight);
    }
  });

  it("ガイドの表にある規則は_すべて実装にある", () => {
    for (const row of rows) expect(expected.has(row.name), `実装にない規則 ${row.name}`).toBe(true);
  });

  it("ガイドの表で_同じ名前を重ねて載せない", () => {
    const names = rows.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("下書きの手順と設定の一致", () => {
  const text = read("drafting.md");

  it("plan と draft の設定の項目が_手順に載っている", () => {
    for (const key of Object.keys(baseConfig.plan)) expect(text, `plan.${key}`).toContain(`plan.${key}`);
    for (const key of Object.keys(baseConfig.draft)) expect(text, `draft.${key}`).toContain(`draft.${key}`);
  });

  it("コマンドの使い方が_手順に載っている", () => {
    for (const command of [
      "plan <試験コード>",
      "draft <試験コード>",
      "draft <試験コード> --import",
      "draft <試験コード> --check",
    ]) {
      expect(text).toContain(`npm run pipeline -- ${command}`);
    }
  });

  it("置き場所の設定の項目が_実在する", () => {
    expect(baseConfig.provenanceDir).toBe("packages/pipeline/provenance");
    expect(text).toContain("packages/pipeline/provenance/<コード>.json");
  });
});

describe("文書の参照", () => {
  const files = ["question-style.md", "drafting.md"];

  it.each(files)("%s_相対リンクの先が実在する", (name) => {
    const text = read(name);
    for (const m of text.matchAll(/\]\((\.\/[^)#]+)\)/g)) {
      const target = resolve(dirname(resolve(docsDir, name)), m[1] as string);
      expect(existsSync(target), `${name} から ${m[1]}`).toBe(true);
    }
  });

  it("エージェントの定義と実装が参照する文書が_実在する", () => {
    expect(existsSync(resolve(docsDir, "question-style.md"))).toBe(true);
    const agent = readFileSync(resolve(docsDir, "../.claude/agents/question-drafter.md"), "utf8");
    expect(agent).toContain("docs/question-style.md");
  });

  it("2 つの文書が_互いを参照している", () => {
    expect(read("question-style.md")).toContain("./drafting.md");
    expect(read("drafting.md")).toContain("./question-style.md");
  });
});
