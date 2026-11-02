// @vitest-environment jsdom
import { fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { TocDomain } from "@/lib/notebook-data.ts";
import { NotebookShell, revealCurrent } from "./notebook-shell.tsx";

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

  it("目次の追従_広い画面は上のバーの下に固定_狭い画面の目次のボタンも上のバーの下に固定", () => {
    renderShell();
    const nav = screen.getByRole("navigation", { name: "体系ノートの目次" });
    const sticky = nav.parentElement?.getAttribute("class") ?? "";
    expect(sticky).toContain("sticky");
    expect(sticky).toContain("top-16");
    expect(sticky).toContain("lg:top-4");
    const bar = screen.getByTestId("notebook-toc-bar");
    expect(bar.getAttribute("class")).toContain("sticky");
    expect(bar.getAttribute("class")).toContain("pointer-events-none");
    expect(within(bar).getByRole("button", { name: "目次" }).getAttribute("class")).toContain("pointer-events-auto");
  });
});

/** 箱の位置を、上端と高さで決める(jsdom は配置を計算しないため) */
function place(element: Element, top: number, height: number) {
  element.getBoundingClientRect = () => ({ top, bottom: top + height, height }) as DOMRect;
}

describe("revealCurrent", () => {
  function list() {
    const container = document.createElement("div");
    container.innerHTML = '<a href="#a">a</a><a href="#b" aria-current="page">b</a>';
    place(container, 0, 100);
    return { container, item: container.querySelector('[aria-current="page"]') as Element };
  }

  it("いまの項目が見える範囲の下にある_目次だけを中ほどまでスクロールする", () => {
    const { container, item } = list();
    place(item, 300, 20);
    revealCurrent(container);
    expect(container.scrollTop).toBe(260);
  });

  it("いまの項目が見えている_スクロールしない", () => {
    const { container, item } = list();
    place(item, 40, 20);
    revealCurrent(container);
    expect(container.scrollTop).toBe(0);
  });
});
