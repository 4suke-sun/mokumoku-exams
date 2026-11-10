// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Exam } from "@/lib/types.ts";

const exams = [
  {
    examCode: "PRO1",
    status: "published",
    vendor: "AWS",
    edition: "P01",
    name: "プロの資格",
    shortName: "プロ",
    level: "Professional",
    abbr: "PRO",
    category: "x",
    passingScore: 750,
    totalScore: 1000,
    officialQuestionCount: 75,
    officialTimeMinutes: 180,
    beta: true,
    domains: [{ code: "domain1", name: "分野 1", weight: 1 }],
  },
  {
    examCode: "FND1",
    status: "published",
    vendor: "AWS",
    edition: "F01",
    name: "基礎の資格",
    shortName: "基礎",
    level: "Foundational",
    abbr: "FND",
    category: "x",
    passingScore: 700,
    totalScore: 1000,
    officialQuestionCount: 65,
    officialTimeMinutes: 90,
    domains: [{ code: "domain1", name: "分野 1", weight: 1 }],
  },
  {
    examCode: "NOLV",
    status: "published",
    vendor: "AWS",
    edition: "N01",
    name: "レベルのない資格",
    shortName: "レベルなし",
    category: "x",
    passingScore: 700,
    totalScore: 1000,
    officialQuestionCount: 50,
    officialTimeMinutes: 60,
    domains: [{ code: "domain1", name: "分野 1", weight: 1 }],
  },
  {
    examCode: "SOON",
    status: "coming-soon",
    vendor: "Other",
    name: "近日の資格",
    shortName: "近日",
    level: "Associate",
    note: "来春に公開します。",
    // パイプラインに通すための項目を持っていても、一覧の表示は変わらない
    edition: "S01",
    officialQuestionCount: 65,
    idPrefix: "SOON",
    domains: [{ code: "domain1", name: "架空の分野名", weight: 1 }],
  },
] as unknown as Exam[];

vi.mock("@/lib/exam-data.ts", () => ({ listExams: () => exams }));

const { default: ExamsPage } = await import("./page.tsx");

/** サーバーの画面を、URL の検索条件を渡して組み立てる */
async function renderPage(query: { vendor?: string | string[] } = {}) {
  return render(await ExamsPage({ searchParams: Promise.resolve(query) }));
}

describe("資格の一覧", () => {
  it("ベンダーごとに分けて見出しを付ける", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { level: 2, name: "AWS" })).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Other" })).toBeTruthy();
  });

  it("ベンダーの中_レベルの順に並べ_レベルを持たない資格も出す", async () => {
    await renderPage();
    const group = screen.getByRole("heading", { name: "AWS" }).closest("section") as HTMLElement;
    const names = within(group)
      .getAllByRole("listitem")
      .filter((li) => li.className.includes("card"))
      .map((li) => within(li).getAllByRole("link")[0]?.textContent);
    expect(names.map((n) => n?.replace(/\(.*$/, "").replace(/[A-Z0-9]+$/, ""))).toEqual([
      expect.stringContaining("基礎の資格"),
      expect.stringContaining("プロの資格"),
      expect.stringContaining("レベルのない資格"),
    ]);
  });

  it("資格_正式名と資格コードとレベルを出し_タイルは読み上げない", async () => {
    await renderPage();
    const link = screen.getByRole("link", { name: /基礎の資格/ });
    expect(link.getAttribute("href")).toBe("/exams/FND1");
    expect(link.textContent).toContain("FND1(F01)");
    expect(screen.getByText("Foundational")).toBeTruthy();
    const tile = screen.getByText("FND");
    expect(tile.getAttribute("aria-hidden")).toBe("true");
  });

  it("ベータの資格_本番の値のあとに(ベータ)を添え_ほかの資格には出さない", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: /プロの資格/ }).textContent).toContain("(満点 1000 点)(ベータ)");
    expect(screen.getByRole("link", { name: /基礎の資格/ }).textContent).not.toContain("ベータ");
  });

  it("公開中の資格_試験の情報と分野のメニューへ行ける", async () => {
    await renderPage();
    expect(screen.getByRole("link", { name: "基礎の試験の情報" }).getAttribute("href")).toBe("/exams/FND1/info");
    expect(screen.getByRole("navigation", { name: "基礎の分野" })).toBeTruthy();
  });

  it("近日公開の資格_バッジと注記を出し_リンクにしない", async () => {
    await renderPage();
    expect(screen.getByText("近日公開")).toBeTruthy();
    expect(screen.getByText("来春に公開します。")).toBeTruthy();
    expect(screen.queryByRole("link", { name: /近日の資格/ })).toBeNull();
    const card = screen.getByText("近日の資格").closest("li");
    expect(card?.className).toContain("bg-surface/60");
  });

  it("分野・版・出題数・接頭辞を持つ近日公開の資格_それらを一覧に出さない", async () => {
    await renderPage();
    const card = screen.getByText("近日の資格").closest("li");
    expect(card?.textContent).not.toContain("架空の分野名");
    expect(card?.textContent).not.toContain("S01");
    expect(card?.textContent).not.toContain("65");
  });

  it("略称のない資格_資格コードの先頭の 4 文字をタイルに出す", async () => {
    await renderPage();
    expect(screen.getByText("NOLV").getAttribute("aria-hidden")).toBe("true");
  });

  it("ベンダーを指定_そのベンダーの資格だけを出し_切り替えで選んだ項目を示す", async () => {
    await renderPage({ vendor: "Other" });
    expect(screen.queryByRole("heading", { name: "AWS" })).toBeNull();
    expect(screen.getByRole("heading", { name: "Other" })).toBeTruthy();
    const filter = screen.getByRole("navigation", { name: "ベンダーで絞り込む" });
    expect(within(filter).getByRole("link", { name: /Other/ }).getAttribute("aria-current")).toBe("page");
    expect(within(filter).getByRole("link", { name: "すべて" }).getAttribute("href")).toBe("/exams");
  });

  it("ベンダーの指定がない_すべてのベンダーを出し_すべてを選んだ状態にする", async () => {
    await renderPage();
    expect(screen.getByRole("heading", { name: "AWS" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Other" })).toBeTruthy();
    const filter = screen.getByRole("navigation", { name: "ベンダーで絞り込む" });
    expect(
      within(filter)
        .getByRole("link", { name: /すべて/ })
        .getAttribute("aria-current"),
    ).toBe("page");
    expect(within(filter).getByRole("link", { name: "AWS" }).getAttribute("href")).toBe("/exams?vendor=AWS");
  });

  it("一覧にないベンダーを指定_すべてのベンダーを出す", async () => {
    await renderPage({ vendor: "Nope" });
    expect(screen.getByRole("heading", { name: "AWS" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Other" })).toBeTruthy();
  });
});
