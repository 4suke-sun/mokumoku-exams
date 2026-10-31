// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TocDomain } from "@/lib/notebook-data.ts";
import { NotebookShell } from "./notebook-shell.tsx";

const pathname = "/exams/TEST/notebook/domain1-1";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

const toc: TocDomain[] = [
  {
    code: "domain1",
    number: 1,
    name: "分野 1",
    weight: 0.4,
    count: 2,
    filled: 1,
    units: [
      { id: "domain1-1", number: "1-1", title: "テーブルの種類", count: 2 },
      { id: "domain1-2", number: "1-2", title: "空の中分類", count: 0 },
    ],
  },
];

function renderShell() {
  return render(
    <NotebookShell basePath="/exams/TEST/notebook" toc={toc}>
      <p>本文</p>
    </NotebookShell>,
  );
}

describe("NotebookShell", () => {
  it("目次_分野と中分類の 2 段_見出しの数と_空の中分類は補助の色_いまの中分類を示す", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "体系ノートの目次" });
    expect(within(nav).getByText("1. 分野 1")).toBeTruthy();
    const current = within(nav).getByRole("link", { name: /1-1 テーブルの種類/ });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.textContent).toContain("2 件");
    const empty = within(nav).getByRole("link", { name: /1-2 空の中分類/ });
    expect(empty.getAttribute("class")).toContain("text-muted");
    expect(empty.getAttribute("href")).toBe("/exams/TEST/notebook/domain1-2");
  });

  it("狭い画面の目次_開くと閉じるボタンに移り_項目を選ぶと閉じる", () => {
    renderShell();
    const open = screen.getByRole("button", { name: "目次" });
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "目次" });
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(dialog.scrollTop).toBe(0);
    fireEvent.click(within(dialog).getByRole("link", { name: /1-2 空の中分類/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it("狭い画面の目次_外側を押すか_Esc で閉じる", () => {
    renderShell();
    fireEvent.click(screen.getByRole("button", { name: "目次" }));
    fireEvent.click(screen.getByRole("button", { name: "目次を閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "目次" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
