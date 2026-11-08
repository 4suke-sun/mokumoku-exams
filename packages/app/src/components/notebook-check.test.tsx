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
  NotebookSectionChecks,
  NotebookSectionPager,
  NotebookSectionScope,
  NotebookSectionStatus,
} from "./notebook-check.tsx";
import { NotebookProgressProvider } from "./notebook-progress.tsx";

type Data = { units: Map<string, string>; entries: Map<string, string> };
const client = vi.hoisted(() => ({
  fetchNotebook: vi.fn<(examCode: string) => Promise<Data | null>>(),
  putNotebookEntry: vi.fn<(examCode: string, unit: string, entry: string) => Promise<boolean>>(),
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
      {
        id: "domain1-1",
        number: "1-1",
        title: "中分類 1",
        count: 2,
        entries: [
          { id: "e1", term: "用語 1" },
          { id: "e2", term: "用語 2" },
        ],
      },
      { id: "domain1-2", number: "1-2", title: "空の中分類", count: 0, entries: [] },
      { id: "domain1-3", number: "1-3", title: "中分類 3", count: 1, entries: [{ id: "e3", term: "用語 3" }] },
    ],
  },
];
const unit1 = { id: "domain1-1", entries: [{ id: "e1" }, { id: "e2" }] };
const AT = "2026-10-11T15:30:00.000Z";

const data = (units: Record<string, string> = {}, entries: Record<string, string> = {}): Data => ({
  units: new Map(Object.entries(units)),
  entries: new Map(Object.entries(entries)),
});

beforeEach(() => {
  client.fetchNotebook.mockReset();
  client.putNotebookEntry.mockReset();
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

/** 問いに答える(選んで「回答する」を押す) */
async function answerCheck(question: string, text: string) {
  const group = screen.getByRole("group", { name: question });
  choose(group, text);
  await act(async () => fireEvent.click(within(group).getByRole("button", { name: "回答する" })));
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

  it("正解を選んで回答する_正解ですと伝え_結果を伝える関数を呼ぶ", async () => {
    const onResult = vi.fn();
    render(<NotebookCheckItem id="term-one-1" check={check("問い 1", "A")} onResult={onResult} />);
    await act(async () => {});
    const group = screen.getByRole("group", { name: "問い 1" });
    choose(group, "問い 1の A");
    fireEvent.click(within(group).getByRole("button", { name: "回答する" }));
    expect(within(group).getByRole("status").textContent).toBe("○ 正解です");
    expect(onResult).toHaveBeenCalledWith(true);
  });
});

describe("節の確認と完了の記録", () => {
  const two = [check("問い 1", "A"), check("問い 2", "B")];
  function section(checks = [check("問い 1", "A")]) {
    return (
      <NotebookSectionScope unitId="domain1-1" entryId="e1" total={checks.length}>
        <NotebookSectionChecks entryId="e1" checks={checks} />
        <NotebookSectionPager
          basePath="/exams/TEST/notebook"
          unitId="domain1-1"
          prev={{ id: "e0", term: "前の用語" }}
          next={{ id: "e2", term: "次の用語" }}
        />
      </NotebookSectionScope>
    );
  }
  const nextLink = () => screen.queryByRole("link", { name: /次の節へ/ });

  it("節のすべての問いに正解_節の完了を記録し_完了として記録しましたと出し_次の節へが出る", async () => {
    client.fetchNotebook.mockResolvedValue(data());
    client.putNotebookEntry.mockResolvedValue(true);
    await renderWith(section(two));
    await answerCheck("問い 1", "問い 1の A");
    expect(client.putNotebookEntry).not.toHaveBeenCalled();
    expect(nextLink()).toBeNull();
    await answerCheck("問い 2", "問い 2の B");
    expect(client.putNotebookEntry).toHaveBeenCalledTimes(1);
    expect(client.putNotebookEntry).toHaveBeenCalledWith("TEST", "domain1-1", "e1");
    expect(document.body.textContent).toContain("完了として記録しました");
    expect(nextLink()?.getAttribute("href")).toBe("/exams/TEST/notebook/domain1-1/e2");
  });

  it("不正解のあとに解き直して正解_すべての問いに正解したので記録する", async () => {
    client.fetchNotebook.mockResolvedValue(data());
    client.putNotebookEntry.mockResolvedValue(true);
    await renderWith(section());
    await answerCheck("問い 1", "問い 1の B");
    expect(client.putNotebookEntry).not.toHaveBeenCalled();
    expect(nextLink()).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "もう一度" }));
    await answerCheck("問い 1", "問い 1の A");
    expect(client.putNotebookEntry).toHaveBeenCalledTimes(1);
  });

  it("前の節へ_確認の前でも戻れる", async () => {
    client.fetchNotebook.mockResolvedValue(data());
    await renderWith(section());
    expect(screen.getByRole("link", { name: /前の節/ }).getAttribute("href")).toBe("/exams/TEST/notebook/domain1-1/e0");
  });

  it("記録できなかった_記録できませんでしたと出し_もう一度記録できる", async () => {
    client.fetchNotebook.mockResolvedValue(data());
    client.putNotebookEntry.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await renderWith(section());
    await answerCheck("問い 1", "問い 1の A");
    expect(document.body.textContent).toContain("記録できませんでした");
    expect(nextLink()).not.toBeNull();
    await act(async () => fireEvent.click(screen.getByRole("button", { name: "もう一度記録する" })));
    expect(client.putNotebookEntry).toHaveBeenCalledTimes(2);
    expect(document.body.textContent).toContain("完了として記録しました");
  });

  it("すでに完了している節_最初から完了として記録していますと次の節へを出し_正解しても書き直さない", async () => {
    client.fetchNotebook.mockResolvedValue(data({}, { "domain1-1#e1": AT }));
    await renderWith(section());
    expect(document.body.textContent).toContain("完了として記録しています");
    expect(nextLink()).not.toBeNull();
    await answerCheck("問い 1", "問い 1の A");
    expect(client.putNotebookEntry).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("完了として記録しています");
  });

  it("旧い中分類の記録で完了している節_正解したら節の完了を書き_書けなくても完了として記録しています", async () => {
    client.fetchNotebook.mockResolvedValue(data({ "domain1-1": AT }));
    client.putNotebookEntry.mockResolvedValue(false);
    await renderWith(section());
    expect(document.body.textContent).toContain("完了として記録しています");
    await answerCheck("問い 1", "問い 1の A");
    expect(client.putNotebookEntry).toHaveBeenCalledWith("TEST", "domain1-1", "e1");
    expect(document.body.textContent).toContain("完了として記録しています");
    expect(document.body.textContent).not.toContain("記録できませんでした");
  });

  it("読み込み中_記録の状態を出さず次の節へも出さない_正解したあとは記録の結果と次の節へを出す", async () => {
    client.fetchNotebook.mockReturnValue(new Promise(() => {}));
    client.putNotebookEntry.mockResolvedValue(true);
    await renderWith(section());
    expect(document.body.textContent).not.toContain("記録");
    expect(nextLink()).toBeNull();
    await answerCheck("問い 1", "問い 1の A");
    expect(document.body.textContent).toContain("完了として記録しました");
    expect(nextLink()).not.toBeNull();
  });

  it("読めない_記録の状態を出さず_正解したあとの記録の結果だけを出す", async () => {
    client.fetchNotebook.mockResolvedValue(null);
    client.putNotebookEntry.mockResolvedValue(false);
    await renderWith(section());
    expect(document.body.textContent).not.toContain("記録");
    expect(nextLink()).toBeNull();
    await answerCheck("問い 1", "問い 1の A");
    expect(document.body.textContent).toContain("記録できませんでした");
    expect(nextLink()).not.toBeNull();
  });

  it("管理者のプレビュー_読まず記録もせず_プレビューでは記録しませんと出し_次の節へは正解のあとに出す", async () => {
    await renderWith(section(), true);
    expect(nextLink()).toBeNull();
    await answerCheck("問い 1", "問い 1の A");
    expect(client.fetchNotebook).not.toHaveBeenCalled();
    expect(client.putNotebookEntry).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain("プレビューでは記録しません");
    expect(nextLink()).not.toBeNull();
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
  const allDone = () => data({}, { "domain1-1#e1": AT, "domain1-1#e2": AT });

  it("中分類の節がすべて完了するまで_出さない", async () => {
    client.fetchNotebook.mockResolvedValue(data({}, { "domain1-1#e1": AT }));
    await renderWith(<NotebookReview unit={unit1} items={items} />);
    expect(screen.queryByRole("region", { name: "ここまでのおさらい" })).toBeNull();
  });

  it("読めないとき_出さない", async () => {
    client.fetchNotebook.mockResolvedValue(null);
    await renderWith(<NotebookReview unit={unit1} items={items} />);
    expect(screen.queryByRole("region", { name: "ここまでのおさらい" })).toBeNull();
  });

  it("旧い中分類の記録がある_全節が完了として扱われ_出す", async () => {
    client.fetchNotebook.mockResolvedValue(data({ "domain1-1": AT }));
    await renderWith(<NotebookReview unit={unit1} items={items} />);
    expect(review().textContent).toContain("任意の総復習");
  });

  it("全問を選ぶまで回答できず_未選択の数を示す", async () => {
    client.fetchNotebook.mockResolvedValue(allDone());
    await renderWith(<NotebookReview unit={unit1} items={items} />);
    const submit = within(review()).getByRole("button", { name: "回答する" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    expect(review().textContent).toContain("未選択 2 問");
    choose(review(), "問い 1の A");
    expect(review().textContent).toContain("未選択 1 問");
    choose(review(), "問い 2の B");
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("通しで全問正解_全問正解ですだけを出し_何も記録しない", async () => {
    client.fetchNotebook.mockResolvedValue(allDone());
    await renderWith(<NotebookReview unit={unit1} items={items} />);
    await act(async () => answer(["問い 1の A", "問い 2の B"]));
    expect(within(review()).getAllByRole("status")[0]?.textContent).toBe("○ 全問正解です");
    expect(review().textContent).not.toContain("記録");
    expect(client.putNotebookEntry).not.toHaveBeenCalled();
    expect(client.fetchNotebook).toHaveBeenCalledTimes(1);
  });

  it("間違いがある_正解の数と理由を出し_もう一度通すで未回答に戻る", async () => {
    client.fetchNotebook.mockResolvedValue(allDone());
    await renderWith(<NotebookReview unit={unit1} items={items} />);
    await act(async () => answer(["問い 1の A", "問い 2の A"]));
    expect(client.putNotebookEntry).not.toHaveBeenCalled();
    expect(review().textContent).toContain("2 問中 1 問正解です");
    expect(review().textContent).toContain("× 不正解");
    expect(review().textContent).toContain("問い 2の A の理由");
    fireEvent.click(within(review()).getByRole("button", { name: "もう一度通す" }));
    expect(within(review()).getAllByRole("radio")).toHaveLength(4);
    expect(review().textContent).toContain("未選択 2 問");
  });

  it("管理者のプレビュー_完了を読まず_いつでも出し_記録しない", async () => {
    await renderWith(<NotebookReview unit={unit1} items={items} />, true);
    await act(async () => answer(["問い 1の A", "問い 2の B"]));
    expect(client.fetchNotebook).not.toHaveBeenCalled();
    expect(client.putNotebookEntry).not.toHaveBeenCalled();
    expect(within(review()).getAllByRole("status")[0]?.textContent).toBe("○ 全問正解です");
  });
});

describe("完了の印と続きから", () => {
  it("完了した節_題の下の行に完了を出し_中分類が履修済みなら日付つきの履修済みも出す", async () => {
    client.fetchNotebook.mockResolvedValue(
      data({}, { "domain1-1#e1": "2026-10-10T00:00:00.000Z", "domain1-1#e2": AT }),
    );
    await renderWith(<NotebookSectionStatus unitId="domain1-1" entryId="e1" entryIds={["e1", "e2"]} />);
    expect(document.body.textContent).toContain("✓ 完了");
    expect(document.body.textContent).toContain("✓ 履修済み(2026/10/12)");
  });

  it("旧い中分類の記録がある_履修済みの日付はその記録の時刻で_節の完了の時刻は使わない", async () => {
    client.fetchNotebook.mockResolvedValue(data({ "domain1-1": "2026-09-01T00:00:00.000Z" }, { "domain1-1#e1": AT }));
    await renderWith(<NotebookSectionStatus unitId="domain1-1" entryId="e2" entryIds={["e1", "e2"]} />);
    expect(document.body.textContent).toContain("✓ 完了");
    expect(document.body.textContent).toContain("✓ 履修済み(2026/9/1)");
  });

  it("節だけ完了_履修済みは出さない_未完了の節は何も出さない", async () => {
    client.fetchNotebook.mockResolvedValue(data({}, { "domain1-1#e1": AT }));
    await renderWith(
      <>
        <span data-testid="s1">
          <NotebookSectionStatus unitId="domain1-1" entryId="e1" entryIds={["e1", "e2"]} />
        </span>
        <span data-testid="s2">
          <NotebookSectionStatus unitId="domain1-1" entryId="e2" entryIds={["e1", "e2"]} />
        </span>
      </>,
    );
    expect(screen.getByTestId("s1").textContent).toBe("✓ 完了");
    expect(screen.getByTestId("s2").textContent).toBe("");
  });

  it("表紙_完了した節の数と履修済みの中分類の数を並べ_最初の完了していない節への続きからを出す(見出しのない中分類は飛ばす)", async () => {
    client.fetchNotebook.mockResolvedValue(data({}, { "domain1-1#e1": AT }));
    await renderWith(
      <>
        <NotebookCoverProgress toc={toc} basePath="/exams/TEST/notebook" />
        {toc[0] ? <NotebookDomainProgress domain={toc[0]} /> : null}
      </>,
    );
    expect(screen.getByText("1 / 3 節")).toBeTruthy();
    expect(screen.getByText("履修済み 0 / 2 中分類")).toBeTruthy();
    expect(screen.getByText("履修済み 0 / 2")).toBeTruthy();
    expect(screen.getByRole("link", { name: /続きから: 1-1 中分類 1 › 用語 2/ }).getAttribute("href")).toBe(
      "/exams/TEST/notebook/domain1-1/e2",
    );
  });

  it("表紙_最初の中分類が完了_次の中分類の最初の節を指す", async () => {
    client.fetchNotebook.mockResolvedValue(data({ "domain1-1": AT }));
    await renderWith(<NotebookCoverProgress toc={toc} basePath="/exams/TEST/notebook" />);
    expect(screen.getByText("2 / 3 節")).toBeTruthy();
    expect(screen.getByText("履修済み 1 / 2 中分類")).toBeTruthy();
    expect(screen.getByRole("link", { name: /続きから/ }).getAttribute("href")).toBe(
      "/exams/TEST/notebook/domain1-3/e3",
    );
  });

  it("表紙_すべて完了_続きからの代わりにすべての節を完了しましたを出す", async () => {
    client.fetchNotebook.mockResolvedValue(data({ "domain1-1": AT, "domain1-3": AT }));
    await renderWith(<NotebookCoverProgress toc={toc} basePath="/exams/TEST/notebook" />);
    expect(screen.getByText(/すべての節を完了しました/)).toBeTruthy();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("読めないとき_印も数も続きからも出さない", async () => {
    client.fetchNotebook.mockResolvedValue(null);
    await renderWith(
      <>
        <NotebookCoverProgress toc={toc} basePath="/exams/TEST/notebook" />
        {toc[0] ? <NotebookDomainProgress domain={toc[0]} /> : null}
        <NotebookSectionStatus unitId="domain1-1" entryId="e1" entryIds={["e1", "e2"]} />
      </>,
    );
    expect(document.body.textContent).toBe("");
  });

  it("この画面で節を完了にした_その節のページの完了の印に押印の動きを付ける", async () => {
    client.fetchNotebook.mockResolvedValueOnce(data()).mockResolvedValueOnce(data({}, { "domain1-1#e1": AT }));
    client.putNotebookEntry.mockResolvedValue(true);
    await renderWith(
      <NotebookSectionScope unitId="domain1-1" entryId="e1" total={1}>
        <NotebookSectionStatus unitId="domain1-1" entryId="e1" entryIds={["e1", "e2"]} />
        <NotebookSectionChecks entryId="e1" checks={[check("問い 1", "A")]} />
      </NotebookSectionScope>,
    );
    expect(document.querySelector(".motion-stamp")).toBeNull();
    await answerCheck("問い 1", "問い 1の A");
    expect(document.querySelector(".chip .motion-stamp")?.textContent).toBe("✓");
  });
});
