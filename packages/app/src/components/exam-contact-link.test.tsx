// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ExamContactLink, examContactHref } from "./exam-contact-link.tsx";

const navigation = vi.hoisted(() => ({ pathname: "/" }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname }));

afterEach(() => {
  cleanup();
});

describe("ExamContactLink", () => {
  it("試験の画面_資格コードを付けたお問い合わせへのリンクを出す", () => {
    navigation.pathname = "/exams/EX-SMP-XX/study/basics";
    render(<ExamContactLink />);
    expect(screen.getByRole("link", { name: "この試験についてお問い合わせ" }).getAttribute("href")).toBe(
      "/contact?exam=EX-SMP-XX",
    );
  });

  it("試験の外の画面_リンクを出さない", () => {
    for (const pathname of ["/", "/exams", "/contact", "/review"]) {
      navigation.pathname = pathname;
      const { container } = render(<ExamContactLink />);
      expect(container.innerHTML, pathname).toBe("");
      cleanup();
    }
  });

  it("資格コードに URL で特別な文字がある_符号化して付ける", () => {
    expect(examContactHref("A&B")).toBe("/contact?exam=A%26B");
  });
});
