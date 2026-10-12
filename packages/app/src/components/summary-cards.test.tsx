// @vitest-environment jsdom
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import type { SummaryCardView } from "@/lib/summary-data.ts";
import { SummaryCards } from "./summary-cards.tsx";

const exam = { examCode: "TEST", name: "テスト資格", domains: [{ code: "domain1", name: "分野 1", weight: 1 }] };

const card = (n: number, over: Partial<SummaryCardView> = {}): SummaryCardView => ({
  questionId: `TEST-000${n}`,
  domain: "domain1",
  difficulty: "medium",
  questionType: "single",
  question: `問いの要約 ${n}`,
  answers: [{ key: "B", text: `正解の選択肢 ${n}` }],
  point: `決め手 ${n}`,
  ...over,
});
const cards = [
  card(1),
  card(2),
  card(3, {
    questionType: "multiple",
    answers: [
      { key: "A", text: "複数 A" },
      { key: "C", text: "複数 C" },
    ],
  }),
];

describe("SummaryCards", () => {
  it("最初のカード_問いを出し_答えは隠れている", () => {
    render(<SummaryCards exam={exam} cards={cards} />);
    expect(screen.getByText("問いの要約 1")).toBeTruthy();
    expect(screen.getByText("1 / 3 枚目")).toBeTruthy();
    expect(screen.queryByText("正解の選択肢 1")).toBeNull();
    expect(screen.getByRole("button", { name: "答えを見る" }).getAttribute("aria-expanded")).toBe("false");
  });

  it("答えを見る_正解の選択肢と決め手を開き_もう一度で隠す", async () => {
    render(<SummaryCards exam={exam} cards={cards} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "答えを見る" }));
    expect(screen.getByText("正解の選択肢 1")).toBeTruthy();
    expect(screen.getByText("正解")).toBeTruthy();
    expect(screen.getByText(/決め手 1/)).toBeTruthy();
    const toggle = screen.getByRole("button", { name: "答えを隠す" });
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    await user.click(toggle);
    expect(screen.queryByText("正解の選択肢 1")).toBeNull();
  });

  it("次へ・前へ_カードを移り_答えは隠れた状態に戻る", async () => {
    render(<SummaryCards exam={exam} cards={cards} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "答えを見る" }));
    await user.click(screen.getByRole("button", { name: "次へ" }));
    expect(screen.getByText("問いの要約 2")).toBeTruthy();
    expect(screen.getByText("2 / 3 枚目")).toBeTruthy();
    expect(screen.queryByText(/決め手 1/)).toBeNull();
    await user.click(screen.getByRole("button", { name: "前へ" }));
    expect(screen.getByText("問いの要約 1")).toBeTruthy();
  });

  it("巡回する_最初の前は最後_最後の次は最初(ボタンの名前も変わる)", async () => {
    render(<SummaryCards exam={exam} cards={cards} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "前へ" }));
    expect(screen.getByText("3 / 3 枚目")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "最初のカードへ戻る" }));
    expect(screen.getByText("1 / 3 枚目")).toBeTruthy();
  });

  it("複数選択のカード_正解の数を示し_すべての正解を並べる", async () => {
    render(<SummaryCards exam={exam} cards={[cards[2] as SummaryCardView]} />);
    expect(screen.getByText("正解は 2 つです。")).toBeTruthy();
    await userEvent.setup().click(screen.getByRole("button", { name: "答えを見る" }));
    expect(screen.getByText("複数 A")).toBeTruthy();
    expect(screen.getByText("複数 C")).toBeTruthy();
  });

  it("キーボード_N と P で前後へ_A と Enter で答えの開閉", () => {
    render(<SummaryCards exam={exam} cards={cards} />);
    fireEvent.keyDown(window, { key: "a" });
    expect(screen.getByText("正解の選択肢 1")).toBeTruthy();
    fireEvent.keyDown(window, { key: "Enter" });
    expect(screen.queryByText("正解の選択肢 1")).toBeNull();
    fireEvent.keyDown(window, { key: "n" });
    expect(screen.getByText("問いの要約 2")).toBeTruthy();
    fireEvent.keyDown(window, { key: "ArrowRight" });
    fireEvent.keyDown(window, { key: "ArrowRight" });
    expect(screen.getByText("問いの要約 1")).toBeTruthy();
    fireEvent.keyDown(window, { key: "p" });
    expect(screen.getByText("問いの要約 3")).toBeTruthy();
  });

  it("修飾キーつき_キー操作を使わない", () => {
    render(<SummaryCards exam={exam} cards={cards} />);
    fireEvent.keyDown(window, { key: "n", ctrlKey: true });
    expect(screen.getByText("問いの要約 1")).toBeTruthy();
  });

  it("分野と難易度_チップで示す", () => {
    render(<SummaryCards exam={exam} cards={cards} />);
    expect(screen.getByText("分野 1")).toBeTruthy();
    expect(screen.getByText("ふつう")).toBeTruthy();
  });

  it("進み具合_数値と文字で伝える", () => {
    render(<SummaryCards exam={exam} cards={cards} />);
    const bar = screen.getByRole("progressbar", { name: "進み具合" });
    expect(bar.getAttribute("aria-valuetext")).toBe("1 / 3 枚目");
  });

  it("モード選択へ戻るリンク", () => {
    render(<SummaryCards exam={exam} cards={cards} />);
    expect(screen.getByRole("link", { name: "モード選択へ戻る" }).getAttribute("href")).toBe("/exams/TEST");
  });

  it("カードがない_案内を出す", () => {
    render(<SummaryCards exam={exam} cards={[]} />);
    expect(screen.getByText("この資格の要約カードは、まだありません。")).toBeTruthy();
  });
});
