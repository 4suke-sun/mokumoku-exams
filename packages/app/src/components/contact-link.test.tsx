// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ContactLink, examContactHref } from "./contact-link.tsx";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

afterEach(() => {
  cleanup();
});

describe("ContactLink", () => {
  it("試験の画面_資格コードを付けたお問い合わせへのリンクを 1 つ出す", () => {
    navigation.pathname = "/exams/EX-SMP-XX/study/basics";
    render(<ContactLink />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(screen.getByRole("link", { name: "お問い合わせ" }).getAttribute("href")).toBe("/contact?exam=EX-SMP-XX");
  });

  it("試験の外の画面_資格コードを付けないお問い合わせへのリンクを 1 つ出す", () => {
    for (const pathname of ["/", "/exams", "/contact", "/review"]) {
      navigation.pathname = pathname;
      render(<ContactLink />);
      expect(screen.getAllByRole("link"), pathname).toHaveLength(1);
      expect(screen.getByRole("link", { name: "お問い合わせ" }).getAttribute("href"), pathname).toBe("/contact");
      cleanup();
    }
  });

  it("資格コードを元の文字に戻せない経路_資格コードを付けないお問い合わせへのリンクを出す", () => {
    navigation.pathname = "/exams/%E0%A4%A/info";
    render(<ContactLink />);
    expect(screen.getByRole("link", { name: "お問い合わせ" }).getAttribute("href")).toBe("/contact");
  });

  it("資格コードに URL で特別な文字がある_符号化して付ける", () => {
    expect(examContactHref("A&B")).toBe("/contact?exam=A%26B");
  });
});
