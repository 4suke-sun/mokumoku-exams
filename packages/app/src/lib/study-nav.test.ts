import { describe, expect, it } from "vitest";
import type { CurriculumUnit } from "./curriculum-data.ts";
import { backHref, domainHref, entryHref, groupByDomain, nextStep, studyHref, unitHref } from "./study-nav.ts";

const unit = (id: string, order: number, domain: string, questionIds = [`T-000${order}`]): CurriculumUnit => ({
  id,
  title: `単元 ${id}`,
  domain,
  order,
  sections: [{ id: "s", title: "節", body: "本文" }],
  questionIds,
});

const master = [
  { code: "domain1", name: "分野 1" },
  { code: "domain2", name: "分野 2" },
  { code: "domain3", name: "分野 3(単元なし)" },
  { code: "domain4", name: "分野 4" },
];
const descriptions = [
  { code: "domain1", summary: "分野 1 の説明" },
  { code: "domain2", summary: "分野 2 の説明" },
  { code: "domain4", summary: "分野 4 の説明" },
];
const units = [
  unit("a1", 1, "domain1", ["T-0001", "T-0002"]),
  unit("a2", 2, "domain1", ["T-0002", "T-0003"]),
  unit("b1", 3, "domain2"),
  unit("d1", 4, "domain4"),
  unit("d2", 5, "domain4"),
];
const groups = groupByDomain(master, descriptions, units);

describe("groupByDomain", () => {
  it("資格マスタの分野の並びで_単元のない分野は含めない", () => {
    expect(groups.map((g) => g.code)).toEqual(["domain1", "domain2", "domain4"]);
  });

  it("分野の名前と説明と単元_名前はマスタから説明はカリキュラムから", () => {
    expect(groups[0]).toMatchObject({ name: "分野 1", summary: "分野 1 の説明" });
    expect(groups[0]?.units.map((u) => u.id)).toEqual(["a1", "a2"]);
  });

  it("問題の数_単元をまたいで重なる問題は 1 問と数える", () => {
    expect(groups[0]?.questionCount).toBe(3);
  });
});

describe("入口と戻り先", () => {
  it("単元が 1 つの分野_単元の画面へ直接進む", () => {
    expect(entryHref("T", groups[1] as never)).toBe("/exams/T/study/b1");
  });

  it("単元が複数の分野_単元の一覧へ進む", () => {
    expect(entryHref("T", groups[0] as never)).toBe("/exams/T/study/domains/domain1");
  });

  it("単元の画面から戻る先_複数なら単元の一覧_1 つなら分野の一覧", () => {
    expect(backHref("T", groups[0] as never)).toBe(domainHref("T", "domain1"));
    expect(backHref("T", groups[1] as never)).toBe(studyHref("T"));
  });

  it("経路_資格コードと ID から作る", () => {
    expect(unitHref("T", "a1")).toBe("/exams/T/study/a1");
  });
});

describe("nextStep", () => {
  it("同じ分野に次の単元がある_次の単元を示す", () => {
    expect(nextStep("T", groups, "a1")).toEqual({
      nextUnit: { href: "/exams/T/study/a2", title: "単元 a2" },
      nextDomain: null,
      listHref: "/exams/T/study",
    });
  });

  it("分野の最後の単元_次の分野の入口(単元が 1 つなら単元)を示す", () => {
    expect(nextStep("T", groups, "a2").nextDomain).toEqual({ href: "/exams/T/study/b1", name: "分野 2" });
  });

  it("次の分野の単元が複数_単元の一覧を示す", () => {
    expect(nextStep("T", groups, "b1").nextDomain).toEqual({
      href: "/exams/T/study/domains/domain4",
      name: "分野 4",
    });
  });

  it("最後の分野の最後の単元_分野の一覧だけ", () => {
    expect(nextStep("T", groups, "d2")).toEqual({ nextUnit: null, nextDomain: null, listHref: "/exams/T/study" });
  });

  it("知らない単元_分野の一覧だけ", () => {
    expect(nextStep("T", groups, "zzz").nextUnit).toBeNull();
  });
});
