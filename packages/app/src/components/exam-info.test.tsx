// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { PublishedExam } from "@/lib/types.ts";
import { ExamInfo, formatCheckedDate, formatFee } from "./exam-info.tsx";

const base = {
  examCode: "TEST",
  status: "published",
  vendor: "Example",
  edition: "T01",
  name: "テスト資格",
  shortName: "テスト",
  category: "Business",
  passingScore: 700,
  totalScore: 1000,
  officialQuestionCount: 85,
  officialTimeMinutes: 170,
  domains: [
    { code: "domain1", name: "分野 1", weight: 0.6 },
    { code: "domain2", name: "分野 2", weight: 0.4 },
  ],
} as PublishedExam;

const full = {
  ...base,
  level: "Associate",
  info: {
    checkedAt: "2026-10-12",
    format: "択一選択式と複数選択式",
    languages: ["日本語", "英語"],
    fee: { amount: 15000, currency: "JPY", note: "税別" },
    validityYears: 3,
    lastExamDate: "2026-11-30",
    guideUrl: "https://docs.aws.amazon.com/guide.html",
  },
} as PublishedExam;

const render_ = (exam: PublishedExam, unitCount: number | null = 13) =>
  render(<ExamInfo exam={exam} questionCount={200} choiceCount={176} unitCount={unitCount} />);

const value = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe("ExamInfo", () => {
  it("情報を持つ資格_各項目を出す", () => {
    render_(full);
    expect(screen.getByRole("heading", { level: 1, name: "テストの試験の情報" })).toBeTruthy();
    expect(value("合格点")).toBe("700 / 1000(70%)");
    expect(value("問題数")).toBe("85 問");
    expect(value("試験時間")).toBe("170 分");
    expect(value("出題形式")).toBe("択一選択式と複数選択式");
    expect(value("受験できる言語")).toBe("日本語、英語");
    expect(value("受験料")).toBe("15,000 JPY(税別)");
    expect(value("認定の有効期間")).toBe("3 年");
    expect(value("受験できる最終日")).toBe("2026 年 11 月 30 日");
    expect(value("レベル")).toBe("Associate");
  });

  it("情報を持たない資格_持たない項目は出さず_空欄にもしない", () => {
    render_(base);
    for (const label of ["出題形式", "受験できる言語", "受験料", "認定の有効期間", "受験できる最終日", "レベル"]) {
      expect(screen.queryByText(label)).toBeNull();
    }
    // 持っている項目(資格マスタの値)は、そのまま出る
    expect(value("合格点")).toBe("700 / 1000(70%)");
    expect(screen.queryByRole("link", { name: /試験ガイド/ })).toBeNull();
    for (const dd of document.querySelectorAll("dd")) expect(dd.textContent?.trim()).not.toBe("");
    expect(screen.getByText(/公式の詳しい情報を、まだ載せていません/)).toBeTruthy();
  });

  it("一部の項目だけ持つ_持つ項目だけ出す", () => {
    render_({ ...base, info: { checkedAt: "2026-10-12", languages: ["日本語"] } } as PublishedExam);
    expect(value("受験できる言語")).toBe("日本語");
    expect(screen.queryByText("受験料")).toBeNull();
    expect(screen.queryByText("出題形式")).toBeNull();
  });

  it("情報の時点_確認した日を出す", () => {
    render_(full);
    expect(screen.getByText(/公式の情報を確認した日: 2026 年 10 月 12 日/)).toBeTruthy();
  });

  it("公式の試験ガイド_新しいタブで開き_参照元の情報を渡さない", () => {
    render_(full);
    const link = screen.getByRole("link", { name: /試験ガイド/ });
    expect(link.getAttribute("href")).toBe("https://docs.aws.amazon.com/guide.html");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("分野と配点_バーと文字で示し_シンプル用の表も持つ", () => {
    render_(full);
    const bars = screen.getAllByRole("list", { name: "分野ごとの配点" })[0];
    expect(bars?.textContent).toContain("分野 1");
    expect(bars?.textContent).toContain("60%");
    expect(bars?.textContent).toContain("40%");
    const table = screen.getByRole("table", { name: "分野ごとの配点" });
    expect(within(table).getByText("分野 2")).toBeTruthy();
  });

  it("問題の数と単元の数_カリキュラムがなければ準備中", () => {
    const { unmount } = render_(full, 13);
    expect(screen.getByText("問題 200 問(選択式 176 問)")).toBeTruthy();
    expect(screen.getByText("学習モードの単元 13 件")).toBeTruthy();
    unmount();
    render_(full, null);
    expect(screen.getByText("学習モードは、準備中です")).toBeTruthy();
  });

  it("モード選択へ戻るリンク", () => {
    render_(full);
    expect(screen.getByRole("link", { name: "モード選択へ戻る" }).getAttribute("href")).toBe("/exams/TEST");
  });
});

describe("formatCheckedDate と formatFee", () => {
  it("確認した日_年月日に直す", () => {
    expect(formatCheckedDate("2026-01-05")).toBe("2026 年 1 月 5 日");
  });

  it("読めない値_そのまま返す", () => {
    expect(formatCheckedDate("不明")).toBe("不明");
  });

  it("受験料_桁区切りと通貨_補足があれば添える", () => {
    expect(formatFee({ amount: 100, currency: "USD" })).toBe("100 USD");
    expect(formatFee({ amount: 12000, currency: "JPY", note: "ベータは別" })).toBe("12,000 JPY(ベータは別)");
  });
});
