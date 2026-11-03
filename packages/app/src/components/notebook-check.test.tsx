// @vitest-environment jsdom
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TocDomain } from "@/lib/notebook-data.ts";
import type { NotebookCheck, ReviewItem } from "@/lib/notebook-review.ts";
import {
  NotebookCheckItem,
  NotebookCoverProgress,
  NotebookDomainProgress,
  NotebookReview,
  NotebookTocMark,
  NotebookUnitCompleted,
} from "./notebook-check.tsx";
import { NotebookProgressProvider } from "./notebook-progress.tsx";

const client = vi.hoisted(() => ({
  fetchNotebookUnits: vi.fn<(examCode: string) => Promise<Map<string, string> | null>>(),
  putNotebookUnit: vi.fn<(examCode: string, unit: string) => Promise<boolean>>(),
}));
vi.mock("@/lib/history/client.ts", () => client);

const check = (question: string, correct: "A" | "B" = "A"): NotebookCheck => ({
  question,
  choices: [
    { key: "A", text: `${question}の A`, reason: `${question}の A の理由` },
    { key: "B", text: `${question}の B`, reason: `${question}の B の理由` },
  ],
  correct,
});
const items: ReviewItem[] = [
  { id: "term-one-1", term: "用語 1", check: check("問い 1", "A") },
  { id: "term-two-1", term: "用語 2", check: check("問い 2", "B") },
];
const toc: TocDomain[] = [
  {
    code: "domain1",
    number: 1,
    name: "分野 1",
    count: 3,
    filled: 2,
    units: [
      { id: "domain1-1", number: "1-1", title: "中分類 1", count: 2 },
      { id: "domain1-2", number: "1-2", title: "空の中分類", count: 0 },
      { id: "domain1-3", number: "1-3", title: "中分類 3", count: 1 },
    ],
  },
];
const AT = "2026-10-11T15:30:00.000Z";

beforeEach(() => {
  client.fetchNotebookUnits.mockReset();
  client.putNotebookUnit.mockReset();
});
afterEach(() => {
  localStorage.clear();
});

async function renderWith(node: React.ReactNode, preview = false) {
  render(
    <NotebookProgressProvider examCode="TEST" preview={preview}>
      {node}
    </NotebookProgressProvider>,
  );
  await act(async () => {});
}

/** 選択肢の文で、ラジオを選ぶ(画面の並びは入れ替わることがあるので、文で探す) */
function choose(scope: HTMLElement, text: string) {
  fireEvent.click(within(scope).getByRole("radio", { name: new RegExp(text) }));
}

describe("NotebookCheckItem", () => {
  it("選ぶまで回答できず_回答したら正誤と選択肢ごとの理由が出て_もう一度で戻る", async () => {
    render(<NotebookCheckItem id="term-one-1" check={check("問い 1", "A")} />);
    await act(async () => {});
    const group = screen.getByRole("group", { name: "問い 1" });
    const submit = within(group).getByRole("button", { name: "回答する" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    choose(group, "問い 1の B");
    fireEvent.click(submit);
    expect(within(group).getByRole("status").textContent).toBe("× 不正解です");
    expect(group.textContent).toContain("問い 1の A の理由");
    expect(group.textContent).toContain("問い 1の B の理由");
    expect(group.textContent).toContain("○ 正解");
    expect(group.textContent).toContain("あなたの回答");
    expect(within(group).queryAllByRole("radio")).toHaveLength(0);
    fireEvent.click(within(group).getByRole("button", { name: "もう一度" }));
    expect(within(group).getAllByRole("radio")).toHaveLength(2);
    expect(group.textContent).not.toContain("問い 1の A の理由");
  });

  it("正解を選んで回答する_正解ですと伝え_結果を保存しない", async () => {
    render(<NotebookCheckItem id="term-one-1" check={check("問い 1", "A")} />);
    await act(async () => {});
    const group = screen.getByRole("group", { name: "問い 1" });
    choose(group, "問い 1の A");
    fireEvent.click(within(group).getByRole("button", { name: "回答する" }));
    expect(within(group).getByRole("status").textContent).toBe("○ 正解です");
    expect(client.putNotebookUnit).not.toHaveBeenCalled();
  });
});

describe("NotebookReview", () => {
  function review() {
    return screen.getByRole("region", { name: "ここまでのおさらい" });
  }
  function answer(texts: string[]) {
    for (const text of texts) choose(review(), text);
    fireEvent.click(within(review()).getByRole("button", { name: "回答する" }));
  }

  it("全問を選ぶまで回答できず_未選択の数を示す", async () => {
    client.fetchNotebookUnits.mockResolvedValue(new Map());
    await renderWith(<NotebookReview unitId="domain1-1" items={items} />);
    const submit = within(review()).getByRole("button", { name: "回答する" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(review().textContent).toContain("未選択 2 問");
    choose(review(), "問い 1の A");
    expect(review().textContent).toContain("未選択 1 問");
    choose(review(), "問い 2の B");
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("通しで全問正解_中分類を履修済みとして記録し_記録しましたと出す", async () => {
    client.fetchNotebookUnits.mockResolvedValueOnce(new Map()).mockResolvedValueOnce(new Map([["domain1-1", AT]]));
    client.putNotebookUnit.mockResolvedValue(true);
    await renderWith(<NotebookReview unitId="domain1-1" items={items} />);
    await act(async () => answer(["問い 1の A", "問い 2の B"]));
    expect(client.putNotebookUnit).toHaveBeenCalledWith("TEST", "domain1-1");
    expect(within(review()).getAllByRole("status")[0]?.textContent).toBe("○ 全問正解です");
    expect(review().textContent).toContain("履修済みとして記録しました");
  });

  it("間違いがある_記録せず_正解の数と理由を出し_もう一度通すで未回答に戻る", async () => {
    client.fetchNotebookUnits.mockResolvedValue(new Map());
    await renderWith(<NotebookReview unitId="domain1-1" items={items} />);
    await act(async () => answer(["問い 1の A", "問い 2の A"]));
    expect(client.putNotebookUnit).not.toHaveBeenCalled();
    expect(review().textContent).toContain("2 問中 1 問正解です");
    expect(review().textContent).toContain("× 不正解");
    expect(review().textContent).toContain("問い 2の A の理由");
    fireEvent.click(within(review()).getByRole("button", { name: "もう一度通す" }));
    expect(within(review()).getAllByRole("radio")).toHaveLength(4);
    expect(review().textContent).toContain("未選択 2 問");
  });

  it("記録できなかった_記録できませんでしたと出し_もう一度記録できる", async () => {
    client.fetchNotebookUnits.mockResolvedValue(new Map());
    client.putNotebookUnit.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await renderWith(<NotebookReview unitId="domain1-1" items={items} />);
    await act(async () => answer(["問い 1の A", "問い 2の B"]));
    expect(review().textContent).toContain("記録できませんでした");
    await act(async () => fireEvent.click(within(review()).getByRole("button", { name: "もう一度記録する" })));
    expect(client.putNotebookUnit).toHaveBeenCalledTimes(2);
    expect(review().textContent).toContain("履修済みとして記録しました");
  });

  it("管理者のプレビュー_読まず記録もせず_プレビューでは記録しませんと出す", async () => {
    await renderWith(<NotebookReview unitId="domain1-1" items={items} />, true);
    await act(async () => answer(["問い 1の A", "問い 2の B"]));
    expect(client.fetchNotebookUnits).not.toHaveBeenCalled();
    expect(client.putNotebookUnit).not.toHaveBeenCalled();
    expect(review().textContent).toContain("プレビューでは記録しません");
  });
});

describe("履修済みの印と続きから", () => {
  it("履修済みの中分類_題の近くと目次に印を付け_日付を出す", async () => {
    client.fetchNotebookUnits.mockResolvedValue(new Map([["domain1-1", AT]]));
    await renderWith(
      <>
        <NotebookUnitCompleted unitId="domain1-1" />
        <span data-testid="toc-1">
          <NotebookTocMark unitId="domain1-1" />
        </span>
        <span data-testid="toc-3">
          <NotebookTocMark unitId="domain1-3" />
        </span>
      </>,
    );
    expect(document.body.textContent).toContain("✓ 履修済み(2026/10/12)");
    expect(screen.getByTestId("toc-1").textContent).toContain("履修済み");
    expect(screen.getByTestId("toc-3").textContent).toBe("");
  });

  it("表紙_履修済みの数と_最初の履修済みでない中分類への続きからを出す(見出しのない中分類は飛ばす)", async () => {
    client.fetchNotebookUnits.mockResolvedValue(new Map([["domain1-1", AT]]));
    await renderWith(
      <>
        <NotebookCoverProgress toc={toc} basePath="/exams/TEST/notebook" />
        {toc[0] ? <NotebookDomainProgress domain={toc[0]} /> : null}
      </>,
    );
    expect(screen.getAllByText("履修済み 1 / 2")).toHaveLength(2);
    expect(screen.getByRole("link", { name: /続きから: 1-3 中分類 3/ }).getAttribute("href")).toBe(
      "/exams/TEST/notebook/domain1-3",
    );
  });

  it("表紙_すべて履修済み_続きからの代わりにすべて履修しましたを出す", async () => {
    client.fetchNotebookUnits.mockResolvedValue(
      new Map([
        ["domain1-1", AT],
        ["domain1-3", AT],
      ]),
    );
    await renderWith(<NotebookCoverProgress toc={toc} basePath="/exams/TEST/notebook" />);
    expect(screen.getByText(/すべての中分類を履修しました/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("読めない(未ログイン・通信の失敗)_印も続きからも出さない", async () => {
    client.fetchNotebookUnits.mockResolvedValue(null);
    await renderWith(
      <>
        <NotebookCoverProgress toc={toc} basePath="/exams/TEST/notebook" />
        <NotebookUnitCompleted unitId="domain1-1" />
      </>,
    );
    expect(screen.queryByText(/履修済み/)).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});
