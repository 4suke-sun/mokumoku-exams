import { describe, expect, it } from "vitest";
import { filterByVendor, groupByVendor, levelRank, tileText } from "./exam-list.ts";
import type { Exam } from "./types.ts";

const exam = (examCode: string, vendor: string, over: Record<string, unknown> = {}): Exam =>
  ({ examCode, vendor, status: "published", name: examCode, shortName: examCode, ...over }) as Exam;

describe("levelRank", () => {
  it("易しい順_レベルを持たない資格は最後", () => {
    const order = [undefined, "Specialty", "Foundational", "Professional", "Associate", "Expert"] as const;
    const sorted = [...order].sort((a, b) => levelRank(a) - levelRank(b));
    expect(sorted).toEqual(["Foundational", "Associate", "Professional", "Expert", "Specialty", undefined]);
  });
});

describe("groupByVendor", () => {
  it("ベンダーごとに分け_ベンダーは資格マスタに現れた順", () => {
    const groups = groupByVendor([exam("A1", "AWS"), exam("B1", "Other"), exam("A2", "AWS")]);
    expect(groups.map((g) => [g.vendor, g.exams.map((e) => e.examCode)])).toEqual([
      ["AWS", ["A1", "A2"]],
      ["Other", ["B1"]],
    ]);
  });

  it("ベンダーの中_レベルの順に並べ_同じレベルと持たない資格は元の並びのまま", () => {
    const groups = groupByVendor([
      exam("P1", "AWS", { level: "Professional" }),
      exam("N1", "AWS"),
      exam("F1", "AWS", { level: "Foundational" }),
      exam("N2", "AWS"),
      exam("F2", "AWS", { level: "Foundational" }),
      exam("S1", "AWS", { level: "Specialty" }),
    ]);
    expect(groups[0]?.exams.map((e) => e.examCode)).toEqual(["F1", "F2", "P1", "S1", "N1", "N2"]);
  });

  it("近日公開の資格_公開中のすべてのあとに_レベルの順で並べる", () => {
    const groups = groupByVendor([
      exam("CF", "AWS", { status: "coming-soon", level: "Foundational" }),
      exam("PA", "AWS", { level: "Associate" }),
      exam("CP", "AWS", { status: "coming-soon", level: "Professional" }),
      exam("PN", "AWS"),
      exam("CA", "AWS", { status: "coming-soon", level: "Associate" }),
    ]);
    expect(groups[0]?.exams.map((e) => e.examCode)).toEqual(["PA", "PN", "CF", "CA", "CP"]);
  });

  it("ベンダーの色の番号_現れた順に振り_色の数で繰り返す", () => {
    const groups = groupByVendor([exam("A", "V1"), exam("B", "V2"), exam("C", "V3")], 2);
    expect(groups.map((g) => g.colorIndex)).toEqual([0, 1, 0]);
  });

  it("資格がない_空", () => {
    expect(groupByVendor([])).toEqual([]);
  });

  it("元の配列を変えない", () => {
    const list = [exam("P1", "AWS", { level: "Professional" }), exam("F1", "AWS", { level: "Foundational" })];
    groupByVendor(list);
    expect(list.map((e) => e.examCode)).toEqual(["P1", "F1"]);
  });
});

describe("tileText", () => {
  it("略称がある_略称を使う", () => {
    expect(tileText({ examCode: "EX-SMP-XX", abbr: "SMP" })).toBe("SMP");
  });

  it("略称がない_資格コードの試験略称の部分(4 文字まで)", () => {
    expect(tileText({ examCode: "EX-SMP-XX" })).toBe("SMP");
    expect(tileText({ examCode: "AWS-LONGNAME-C01" })).toBe("LONG");
    expect(tileText({ examCode: "AB" })).toBe("AB");
  });
});

describe("filterByVendor", () => {
  const groups = [
    { vendor: "AWS", colorIndex: 0, exams: [] },
    { vendor: "Databricks", colorIndex: 1, exams: [] },
  ];

  it("一覧にあるベンダー_そのグループだけを色の番号のまま返す", () => {
    expect(filterByVendor(groups, "Databricks")).toEqual([{ vendor: "Databricks", colorIndex: 1, exams: [] }]);
  });

  it("指定がないか一覧にないか複数指定_すべてを返す", () => {
    expect(filterByVendor(groups, undefined)).toEqual(groups);
    expect(filterByVendor(groups, "Nope")).toEqual(groups);
    expect(filterByVendor(groups, ["AWS", "Databricks"])).toEqual(groups);
  });
});
