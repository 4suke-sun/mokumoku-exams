// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ISSUES_URL } from "@/lib/site.ts";
import PrivacyPage from "./page.tsx";

afterEach(() => {
  cleanup();
});

describe("PrivacyPage", () => {
  it("読み物の 1 ページ_仕様の見出しをこの順に出す", () => {
    render(<PrivacyPage />);
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("プライバシーと利用条件");
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "集める情報",
      "使い道",
      "退会のあとに残るもの",
      "消し方",
      "利用条件",
      "問い合わせ",
    ]);
  });

  it("問い合わせ_公開の場なので個人情報を書かないよう注意書きを出す", () => {
    render(<PrivacyPage />);
    const link = screen.getByRole("link", { name: "このサービスのリポジトリの Issue" });
    expect(link.getAttribute("href")).toBe(ISSUES_URL);
    expect(ISSUES_URL).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/issues$/);
    expect(screen.getByText(/メールアドレスなどの個人情報は書かないでください/)).toBeTruthy();
  });

  it("使い道_広告に使わず第三者に渡さないことと_通知のときに渡すものを示す", () => {
    render(<PrivacyPage />);
    expect(screen.getByText(/広告には使いません。第三者には渡しません。/)).toBeTruthy();
    expect(screen.getByText(/プッシュの仕組みへ、購読の情報と通知の本文を渡します/)).toBeTruthy();
  });
});
