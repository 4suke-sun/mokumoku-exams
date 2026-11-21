// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

const published = { examCode: "EX-SMP-XX", name: "見本の資格" };

vi.mock("@/lib/exam-data.ts", () => ({
  findPublishedExam: (code: string) => (code === published.examCode ? published : undefined),
}));
vi.mock("@/components/session-provider.tsx", () => ({
  useSession: () => ({ state: { status: "signed-in" }, reload: async () => {}, signOut: async () => {} }),
}));

const { default: ContactPage } = await import("./page.tsx");

/** サーバーの画面を、URL の検索条件を渡して組み立てる */
async function renderPage(query: { exam?: string | string[] } = {}) {
  return render(await ContactPage({ searchParams: Promise.resolve(query) }));
}

afterEach(() => {
  cleanup();
});

describe("お問い合わせの画面", () => {
  it("exam を付けずに開く_試験の表示なしでフォームを出す", async () => {
    await renderPage();
    expect(screen.getByRole("button", { name: "送る" })).toBeTruthy();
    expect(screen.queryByText("資格コード")).toBeNull();
  });

  it("公開中の資格の exam を付けて開く_資格の名前と資格コードを出してフォームを出す", async () => {
    await renderPage({ exam: "EX-SMP-XX" });
    expect(screen.getByText("見本の資格")).toBeTruthy();
    expect(screen.getByText("EX-SMP-XX")).toBeTruthy();
    expect(screen.getByRole("button", { name: "送る" })).toBeTruthy();
  });

  it("公開中の資格に一致しない exam_見つからないと出し_フォームを出さず_試験なしの画面へのリンクを出す", async () => {
    for (const exam of ["NO-SUCH-XX", "", ["EX-SMP-XX", "EX-SMP-XX"]]) {
      await renderPage({ exam });
      expect(screen.getByText("対象の試験が見つかりません。"), JSON.stringify(exam)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "送る" })).toBeNull();
      expect(screen.getByRole("link", { name: "試験を指定せずにお問い合わせ" }).getAttribute("href")).toBe("/contact");
      cleanup();
    }
  });
});
