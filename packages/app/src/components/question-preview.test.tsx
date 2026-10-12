// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PREVIEW_PAGE_SIZE } from "@/lib/question-filter.ts";
import type { Question } from "@/lib/types.ts";
import { QuestionPreview } from "./question-preview.tsx";

const exam = {
  examCode: "T",
  name: "テスト資格",
  domains: [
    { code: "domain1", name: "分野 1", weight: 0.5 },
    { code: "domain2", name: "分野 2", weight: 0.5 },
  ],
};

const choice = (id: string, over: Record<string, unknown> = {}): Question =>
  ({
    questionId: id,
    examCode: "T",
    domain: "domain1",
    questionType: "single",
    difficulty: "easy",
    questionText: `問題文 ${id}`,
    choices: [
      { key: "A", text: "選択肢 A", explanation: "A の理由" },
      { key: "B", text: "選択肢 B", explanation: "B の理由" },
    ],
    correctAnswers: ["B"],
    explanation: `解説 ${id}`,
    references: [{ title: "公式ドキュメント", url: "https://docs.aws.amazon.com/example.html" }],
    ...over,
  }) as Question;

const freeText = (id: string): Question =>
  ({
    questionId: id,
    examCode: "T",
    domain: "domain2",
    questionType: "free-text",
    questionText: `記述 ${id}`,
    rubric: { criteria: [{ name: "観点 1", keywords: ["語 1", "語 2"], points: 60 }], passingPoints: 60 },
    explanation: `記述の解説 ${id}`,
  }) as Question;

const questions = [
  choice("T-0001"),
  choice("T-0002", { domain: "domain2", difficulty: "hard", supplement: "補足の文" }),
  freeText("T-0003"),
];

describe("QuestionPreview", () => {
  it("全問_正解・解説・出典・補足を最初から出す", () => {
    render(<QuestionPreview exam={exam} questions={questions} />);
    expect(screen.getByText("3 問(全 3 問)。1 / 1 ページ")).toBeTruthy();
    const first = screen.getByText("問題文 T-0001").closest("li") as HTMLElement;
    expect(within(first).getByText("正解: B")).toBeTruthy();
    // 選択肢ごとの理由と、解説と、出典
    expect(within(first).getByText(/B の理由/)).toBeTruthy();
    expect(within(first).getByText(/解説 T-0001/)).toBeTruthy();
    const link = within(first).getByRole("link", { name: /公式ドキュメント/ });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText("補足の文")).toBeTruthy();
  });

  it("自由記述の問題_採点基準を出す", () => {
    render(<QuestionPreview exam={exam} questions={questions} />);
    const item = screen.getByText("記述 T-0003").closest("li") as HTMLElement;
    expect(within(item).getByText(/採点基準\(合格点 60 点\)/)).toBeTruthy();
    expect(within(item).getByText(/語 1、語 2/)).toBeTruthy();
  });

  it("分野で絞り込む_押した状態で示し_件数が変わる_解除で戻る", async () => {
    render(<QuestionPreview exam={exam} questions={questions} />);
    const user = userEvent.setup();
    const chip = screen.getByRole("button", { name: "分野 2" });
    expect(chip.getAttribute("aria-pressed")).toBe("false");
    await user.click(chip);
    expect(chip.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByText("2 問(全 3 問)。1 / 1 ページ")).toBeTruthy();
    expect(screen.queryByText("問題文 T-0001")).toBeNull();
    await user.click(screen.getByRole("button", { name: "絞り込みを解除する" }));
    expect(screen.getByText("3 問(全 3 問)。1 / 1 ページ")).toBeTruthy();
  });

  it("難易度・種類・語で絞り込む", async () => {
    render(<QuestionPreview exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "むずかしい" }));
    expect(screen.getByText(/^1 問\(全 3 問\)/)).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "絞り込みを解除する" }));
    await user.click(screen.getByRole("button", { name: "記述" }));
    expect(screen.getByText("記述 T-0003")).toBeTruthy();
    expect(screen.queryByText("問題文 T-0001")).toBeNull();
    await user.click(screen.getByRole("button", { name: "絞り込みを解除する" }));
    await user.type(screen.getByLabelText("語(問題 ID・問題文・解説)"), "t-0002");
    expect(screen.getByText(/^1 問\(全 3 問\)/)).toBeTruthy();
    expect(screen.getByText("問題文 T-0002")).toBeTruthy();
  });

  it("合う問題がない_案内を出す", async () => {
    render(<QuestionPreview exam={exam} questions={questions} />);
    await userEvent.setup().type(screen.getByLabelText("語(問題 ID・問題文・解説)"), "存在しない語");
    expect(screen.getByText("条件に合う問題がありません。")).toBeTruthy();
    expect(screen.getByText("0 問(全 3 問)")).toBeTruthy();
  });

  it("多い資格_ページに分け_前後へ移れる_絞り込むと最初に戻る", async () => {
    const many = Array.from({ length: PREVIEW_PAGE_SIZE + 5 }, (_, i) => choice(`T-${String(i + 1).padStart(4, "0")}`));
    render(<QuestionPreview exam={exam} questions={many} />);
    const user = userEvent.setup();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(PREVIEW_PAGE_SIZE);
    expect(screen.getByText(/1 \/ 2 ページ/)).toBeTruthy();
    const prev = screen.getByRole("button", { name: "前のページ" });
    expect(prev.hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "次のページ" }));
    expect(screen.getByText("問題文 T-0025")).toBeTruthy();
    expect(screen.queryByText("問題文 T-0001")).toBeNull();
    expect(screen.getByRole("button", { name: "次のページ" }).hasAttribute("disabled")).toBe(true);
    await user.click(screen.getByRole("button", { name: "分野 1" }));
    expect(screen.getByText(/1 \/ 2 ページ/)).toBeTruthy();
  });

  it("管理へ戻るリンク", () => {
    render(<QuestionPreview exam={exam} questions={questions} />);
    expect(screen.getByRole("link", { name: "管理へ戻る" }).getAttribute("href")).toBe("/admin");
  });
});
