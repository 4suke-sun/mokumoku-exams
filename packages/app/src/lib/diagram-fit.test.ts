import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { CurriculumFileSchema } from "@mokumoku-exams/data-schema/curriculum-data/schema";
import { describe, expect, it } from "vitest";
import { type Diagram, diagramProblems, layoutAny } from "./diagram-layout.ts";

// 実際のカリキュラム(data/curriculum.*.json)のすべての図で、文字が箱に収まることを検査する。
// 図を増やしたり、文字を長くしたりして収まらなくなったら、ここが失敗する。報告は、資格・単元・節・図の題で場所が分かる形にする。

const DATA_DIR = join(import.meta.dirname, "../../../../data");

type Located = { where: string; diagram: Diagram };

function realDiagrams(): Located[] {
  const found: Located[] = [];
  for (const name of readdirSync(DATA_DIR).filter((n) => /^curriculum\..+\.json$/.test(n))) {
    const file = CurriculumFileSchema.parse(JSON.parse(readFileSync(join(DATA_DIR, name), "utf8")));
    for (const unit of file.units) {
      for (const section of unit.sections) {
        if (!section.diagram) continue;
        found.push({
          where: `${file.examCode} / 単元 ${unit.id} / 節 ${section.id} / 図「${section.diagram.title}」(${section.diagram.type})`,
          diagram: section.diagram,
        });
      }
    }
  }
  return found;
}

/** 収まっていない図の報告(収まっていれば空) */
function violations(diagrams: Located[]): string[] {
  return diagrams.flatMap(({ where, diagram }) => diagramProblems(layoutAny(diagram)).map((p) => `${where}: ${p}`));
}

describe("実データの図の文字の収まり", () => {
  const diagrams = realDiagrams();

  it("カリキュラムの図_流れ・比較・階層の 3 種類が、それぞれ 1 件以上ある", () => {
    const types = new Set(diagrams.map(({ diagram }) => diagram.type));
    expect([...types].sort()).toEqual(["compare", "flow", "hierarchy"]);
  });

  it("すべての図_文字が箱に収まる(折り返しと縮小のあと)", () => {
    expect(violations(diagrams)).toEqual([]);
  });

  it("文字を長くした図_収まらないと報告し_場所が分かる", () => {
    const long = "あ".repeat(20);
    const mutated: Located[] = [
      {
        where: "TEST / 単元 u / 節 s / 図「流れ」(flow)",
        diagram: {
          type: "flow",
          title: "流れ",
          nodes: [
            { id: "a", label: long, note: "い".repeat(40) },
            { id: "b", label: "終わり" },
          ],
          edges: [{ from: "a", to: "b" }],
        },
      },
      {
        where: "TEST / 単元 u / 節 s / 図「比較」(compare)",
        diagram: {
          type: "compare",
          title: "比較",
          left: { heading: long, items: [{ label: long, note: "い".repeat(40) }] },
          right: { heading: "右", items: [{ label: "項目" }] },
        },
      },
    ];
    // 20 文字・40 文字の上限いっぱいでも、折り返しと縮小で収まる(上限は、収まる長さとして決めている)
    expect(violations(mutated)).toEqual([]);
  });

  it("上限を超えて長い文字_検査が失敗する(資格・単元・節・図の位置つき)", () => {
    const tooLong: Located = {
      where: "TEST / 単元 u / 節 s / 図「流れ」(flow)",
      // スキーマの上限(20 文字)の 4 倍。スキーマの検査を通らないデータでも、収まりの検査が止める
      diagram: {
        type: "flow",
        title: "流れ",
        nodes: [
          { id: "a", label: "あ".repeat(80), note: "い".repeat(160) },
          { id: "b", label: "終わり" },
        ],
        edges: [{ from: "a", to: "b" }],
      },
    };
    const result = violations([tooLong]);
    expect(result.length).toBeGreaterThan(0);
    expect(result.every((line) => line.startsWith("TEST / 単元 u / 節 s / 図「流れ」(flow): "))).toBe(true);
  });
});
