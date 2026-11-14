// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TocDomain } from "@/lib/notebook-data.ts";
import { NotebookShell, revealCurrent } from "./notebook-shell.tsx";

const nav = vi.hoisted(() => ({ pathname: "/exams/TEST/notebook/domain1-1/two" }));
vi.mock("next/navigation", () => ({ usePathname: () => nav.pathname }));

type Data = { units: Map<string, string>; entries: Map<string, string> };
const client = vi.hoisted(() => ({
  fetchNotebook: vi.fn<(examCode: string) => Promise<Data | null>>(),
  putNotebookEntry: vi.fn<(examCode: string, unit: string, entry: string) => Promise<boolean>>(),
}));
vi.mock("@/lib/history/client.ts", () => client);

const AT = "2026-10-11T15:30:00.000Z";
const toc: TocDomain[] = [
  {
    code: "domain1",
    number: 1,
    name: "分野 1",
    weight: 0.4,
    count: 5,
    filled: 2,
    units: [
      {
        id: "domain1-1",
        number: "1-1",
        title: "テーブルの種類",
        count: 2,
        entries: [
          { id: "one", term: "用語 one" },
          { id: "two", term: "用語 two" },
        ],
      },
      { id: "domain1-2", number: "1-2", title: "空の中分類", count: 0, entries: [] },
      {
        id: "domain1-3",
        number: "1-3",
        title: "三つ目",
        count: 3,
        entries: [
          { id: "x", term: "用語 x" },
          { id: "y", term: "用語 y" },
          { id: "z", term: "用語 z" },
        ],
      },
    ],
  },
];

beforeEach(() => {
  nav.pathname = "/exams/TEST/notebook/domain1-1/two";
  client.fetchNotebook.mockReset();
  client.fetchNotebook.mockResolvedValue(null);
});

async function renderShell(preview = true) {
  const view = render(
    <NotebookShell examCode="TEST" preview={preview} basePath="/exams/TEST/notebook" toc={toc}>
      <p>本文</p>
    </NotebookShell>,
  );
  await act(async () => {});
  return view;
}

describe("NotebookShell", () => {
  it("目次_分野と中分類と節の 3 段_いまの中分類だけ節を開き_いまの節を示す", async () => {
    await renderShell();
    const nav = screen.getByRole("navigation", { name: "体系ノートの目次" });
    expect(within(nav).getByText("1. 分野 1")).toBeTruthy();
    const current = within(nav).getByRole("link", { name: /用語 two/ });
    expect(current.getAttribute("aria-current")).toBe("page");
    expect(current.getAttribute("href")).toBe("/exams/TEST/notebook/domain1-1/two");
    expect(
      within(nav)
        .getByRole("link", { name: /用語 one/ })
        .getAttribute("aria-current"),
    ).toBeNull();
    expect(
      within(nav)
        .getByRole("button", { name: /1-1 テーブルの種類/ })
        .getAttribute("aria-expanded"),
    ).toBe("true");
    expect(
      within(nav)
        .getByRole("button", { name: /1-3 三つ目/ })
        .getAttribute("aria-expanded"),
    ).toBe("false");
    expect(within(nav).queryByRole("link", { name: /用語 x/ })).toBeNull();
  });

  it("広い画面の目次を隠す_列をなくし_目次を出すへフォーカスし_出すと戻る", async () => {
    await renderShell();
    const layout = screen.getByTestId("notebook-layout");
    const hide = screen.getByRole("button", { name: "目次を隠す" });
    expect(hide.getAttribute("aria-expanded")).toBe("true");

    fireEvent.click(hide);
    expect(layout.getAttribute("data-toc")).toBe("hidden");
    expect(screen.queryByRole("navigation", { name: "体系ノートの目次" })).toBeNull();
    const show = screen.getByRole("button", { name: "目次を出す" });
    expect(show.getAttribute("aria-expanded")).toBe("false");
    expect(document.activeElement).toBe(show);
    expect(screen.getByText("本文")).toBeTruthy();

    fireEvent.click(show);
    expect(layout.getAttribute("data-toc")).toBe("shown");
    expect(screen.getByRole("navigation", { name: "体系ノートの目次" })).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "目次を隠す" }));
  });

  it("目次を隠したまま節を移る_隠した状態を保つ", async () => {
    const view = await renderShell();
    fireEvent.click(screen.getByRole("button", { name: "目次を隠す" }));
    nav.pathname = "/exams/TEST/notebook/domain1-1/one";
    view.rerender(
      <NotebookShell examCode="TEST" preview={true} basePath="/exams/TEST/notebook" toc={toc}>
        <p>本文</p>
      </NotebookShell>,
    );
    await act(async () => {});
    expect(screen.getByTestId("notebook-layout").getAttribute("data-toc")).toBe("hidden");
  });

  it("中分類の行を押す_節を開閉する", async () => {
    await renderShell();
    const nav = screen.getByRole("navigation", { name: "体系ノートの目次" });
    fireEvent.click(within(nav).getByRole("button", { name: /1-3 三つ目/ }));
    expect(within(nav).getAllByRole("link", { name: /用語 [xyz]/ })).toHaveLength(3);
    fireEvent.click(within(nav).getByRole("button", { name: /1-1 テーブルの種類/ }));
    expect(within(nav).queryByRole("link", { name: /用語 two/ })).toBeNull();
  });

  it("見出しのない中分類_薄く出し_開けず押せない", async () => {
    await renderShell();
    const nav = screen.getByRole("navigation", { name: "体系ノートの目次" });
    expect(within(nav).queryByRole("button", { name: /1-2 空の中分類/ })).toBeNull();
    expect(within(nav).queryByRole("link", { name: /1-2 空の中分類/ })).toBeNull();
    const row = within(nav)
      .getByText(/1-2 空の中分類/)
      .closest("p");
    expect(row?.getAttribute("class")).toContain("text-muted");
  });

  it("中分類のページ_節をまだ選んでいない_いまの中分類を開き_節は強調しない", async () => {
    nav.pathname = "/exams/TEST/notebook/domain1-3";
    await renderShell();
    const target = screen.getByRole("navigation", { name: "体系ノートの目次" });
    expect(within(target).getAllByRole("link", { name: /用語 [xyz]/ })).toHaveLength(3);
    expect(target.querySelector('[aria-current="page"]')).toBeNull();
  });

  it("読み込めた_完了した節に印と読み上げの完了_中分類に完了した節の数_履修済みに印と読み上げの履修済み", async () => {
    client.fetchNotebook.mockResolvedValue({
      units: new Map([["domain1-3", AT]]),
      entries: new Map([["domain1-1#one", AT]]),
    });
    await renderShell(false);
    const target = screen.getByRole("navigation", { name: "体系ノートの目次" });
    const done = within(target).getByRole("link", { name: /用語 one/ });
    expect(done.textContent).toContain("✓");
    expect(done.textContent).toContain("完了");
    expect(within(target).getByRole("link", { name: /用語 two/ }).textContent).not.toContain("✓");
    const unit1 = within(target).getByRole("button", { name: /1-1 テーブルの種類/ });
    expect(unit1.textContent).toContain("1 / 2");
    expect(unit1.textContent).not.toContain("履修済み");
    const unit3 = within(target).getByRole("button", { name: /1-3 三つ目/ });
    expect(unit3.textContent).toContain("3 / 3");
    expect(unit3.textContent).toContain("✓");
    expect(unit3.textContent).toContain("履修済み");
  });

  it("読めないとき_完了の印を出さず_見出しの数を出す", async () => {
    await renderShell(false);
    const target = screen.getByRole("navigation", { name: "体系ノートの目次" });
    expect(target.textContent).not.toContain("✓");
    const row = within(target).getByRole("button", { name: /1-1 テーブルの種類/ });
    expect(within(row).getByText("2 件")).toBeTruthy();
  });

  it("狭い画面の目次_開くと閉じるボタンに移り_節を選ぶと閉じる", async () => {
    await renderShell();
    const open = screen.getByRole("button", { name: "目次" });
    fireEvent.click(open);
    const dialog = screen.getByRole("dialog", { name: "目次" });
    expect(open.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(within(dialog).getByRole("button", { name: "閉じる" }));
    expect(dialog.scrollTop).toBe(0);
    fireEvent.click(within(dialog).getByRole("link", { name: /用語 one/ }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(open);
  });

  it("狭い画面の目次_中分類の行を押しても閉じず_閉じるボタンか_Esc で閉じる", async () => {
    await renderShell();
    fireEvent.click(screen.getByRole("button", { name: "目次" }));
    const dialog = screen.getByRole("dialog", { name: "目次" });
    fireEvent.click(within(dialog).getByRole("button", { name: /1-3 三つ目/ }));
    expect(screen.getByRole("dialog", { name: "目次" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "目次を閉じる" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "目次" }));
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("目次の追従_広い画面は上のバーの下に固定_狭い画面の目次のボタンも上のバーの下に固定", async () => {
    await renderShell();
    const toc = screen.getByRole("navigation", { name: "体系ノートの目次" });
    const sticky = toc.parentElement?.getAttribute("class") ?? "";
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

  it("いまの節が見える範囲の下にある_目次だけを中ほどまでスクロールする", () => {
    const { container, item } = list();
    place(item, 300, 20);
    revealCurrent(container);
    expect(container.scrollTop).toBe(260);
  });

  it("いまの節が見えている_スクロールしない", () => {
    const { container, item } = list();
    place(item, 40, 20);
    revealCurrent(container);
    expect(container.scrollTop).toBe(0);
  });
});
