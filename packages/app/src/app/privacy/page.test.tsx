// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ISSUES_URL } from "@/lib/site.ts";
import PrivacyPage from "./page.tsx";

afterEach(() => {
  cleanup();
});

describe("PrivacyPage", () => {
  it("読み物の 1 ページ_利用規約とプライバシーポリシーの 2 部をこの順に出す", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("利用規約とプライバシーポリシー");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "利用規約",
      "プライバシーポリシー",
    ]);
  });

  it("利用規約_第 1 条から第 10 条までを番号の順に出す", () => {
    render(<PrivacyPage />);
    const articles = screen
      .getAllByRole("heading", { level: 3 })
      .map((h) => h.textContent ?? "")
      .filter((text) => text.startsWith("第"));
    expect(articles.map((text) => text.replace(/^第 (\d+) 条.*$/, "$1"))).toEqual(
      Array.from({ length: 10 }, (_, i) => String(i + 1)),
    );
  });

  it("問い合わせ_公開の場なので個人情報を書かないよう注意書きを出す", () => {
    render(<PrivacyPage />);
    const link = screen.getByRole("link", { name: "このサービスのリポジトリの Issue" });
    expect(link.getAttribute("href")).toBe(ISSUES_URL);
    expect(ISSUES_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues$/);
    expect(screen.getByText(/メールアドレスなどの個人情報は書かないでください/)).toBeTruthy();
  });

  it("利用目的と外部のサービス_広告に使わないことと_通知のときに送るものを示す", () => {
    render(<PrivacyPage />);
    expect(screen.getByText("広告には使いません。")).toBeTruthy();
    expect(screen.getByText(/プッシュの仕組みへ、購読の情報と通知の本文を送ります/)).toBeTruthy();
  });
});
