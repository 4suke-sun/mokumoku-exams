// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state.tsx";

describe("EmptyState", () => {
  it("タイトルと説明を表示する", () => {
    render(<EmptyState title="結果がありません" description="問題を解いてください。" />);
    expect(screen.getByRole("heading", { name: "結果がありません" })).toBeTruthy();
    expect(screen.getByText("問題を解いてください。")).toBeTruthy();
  });

  it("見出しの段階_既定は 2_画面の全体のときは 1", () => {
    const { unmount } = render(<EmptyState title="t" description="d" />);
    expect(screen.getByRole("heading", { level: 2, name: "t" })).toBeTruthy();
    unmount();
    render(<EmptyState title="t" description="d" headingLevel={1} />);
    expect(screen.getByRole("heading", { level: 1, name: "t" })).toBeTruthy();
  });

  it("飾りのアイコン_置かない(絵文字も、常に動く飾りもない)", () => {
    const { container } = render(<EmptyState title="t" description="d" />);
    expect(container.querySelector('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector(".motion-float")).toBeNull();
    expect(container.textContent).toBe("td");
  });

  it("操作を渡すと_リンクとして表示する", () => {
    render(<EmptyState title="t" description="d" action={{ label: "モード選択へ", href: "/exams/EX-SMP-XX" }} />);
    const link = screen.getByRole("link", { name: "モード選択へ" });
    expect(link.getAttribute("href")).toBe("/exams/EX-SMP-XX");
  });

  it("操作を渡さない_リンクを表示しない", () => {
    render(<EmptyState title="t" description="d" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
