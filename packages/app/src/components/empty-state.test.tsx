// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EmptyState } from "./empty-state.tsx";

describe("EmptyState", () => {
  it("タイトルと説明を表示する", () => {
    render(<EmptyState title="結果がありません" description="問題を解くと表示されます。" />);
    expect(screen.getByRole("heading", { name: "結果がありません" })).toBeTruthy();
    expect(screen.getByText("問題を解くと表示されます。")).toBeTruthy();
  });

  it("見出しの段階_既定は 2_画面の全体のときは 1", () => {
    const { unmount } = render(<EmptyState title="t" description="d" />);
    expect(screen.getByRole("heading", { level: 2, name: "t" })).toBeTruthy();
    unmount();
    render(<EmptyState title="t" description="d" headingLevel={1} />);
    expect(screen.getByRole("heading", { level: 1, name: "t" })).toBeTruthy();
  });

  it("アイコンは飾りとして読み上げない", () => {
    const { container } = render(<EmptyState icon="📊" title="t" description="d" />);
    const icon = container.querySelector('[aria-hidden="true"]');
    expect(icon?.textContent).toBe("📊");
  });

  it("操作を渡すと_リンクとして表示する", () => {
    render(<EmptyState title="t" description="d" action={{ label: "モード選択へ", href: "/exams/SAMPLE" }} />);
    const link = screen.getByRole("link", { name: "モード選択へ" });
    expect(link.getAttribute("href")).toBe("/exams/SAMPLE");
  });

  it("操作を渡さない_リンクを表示しない", () => {
    render(<EmptyState title="t" description="d" />);
    expect(screen.queryByRole("link")).toBeNull();
  });
});
