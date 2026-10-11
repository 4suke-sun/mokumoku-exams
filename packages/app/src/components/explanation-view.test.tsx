// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Question } from "@/lib/types.ts";
import { ChoiceReview } from "./choice-review.tsx";
import { ExplanationView } from "./explanation-view.tsx";

const question = {
  questionId: "TEST-0001",
  examCode: "TEST",
  domain: "domain1",
  questionType: "single",
  questionText: "問題文",
  choices: [
    { key: "A", text: "正しい手順。" },
    { key: "B", text: "誤った手順。" },
  ],
  correctAnswers: ["A"],
  explanation:
    "この問題は要件を問うものです。\n\n前提知識\n\n用語\n\n用語の説明です。\n\n他の選択肢が誤りである理由：\n\n誤った手順\n\nB が誤りの理由です。",
  supplement: "補足の本文",
} as Question;

describe("ExplanationView", () => {
  it("見出しごとのカードにし_誤りの理由は選択肢の記号のチップと組にし_補足は折りたたむ", () => {
    const { container } = render(<ExplanationView question={question} />);
    const kinds = [...container.querySelectorAll("[data-kind]")].map((el) => el.getAttribute("data-kind"));
    expect(kinds).toEqual(["requirement", "knowledge", "wrong"]);
    expect(screen.getByRole("heading", { name: /問われている要件/ })).toBeTruthy();
    expect(screen.getByText("B が誤りの理由です。")).toBeTruthy();
    expect(container.querySelector(".choice-chip")?.textContent).toBe("B");
    expect(container.querySelector("details summary")?.textContent).toBe("さらに詳しく");
  });

  it("選択肢を並べ替えた_記号を画面の記号に置き換える", () => {
    const { container } = render(<ExplanationView question={question} choiceOrder={{ "TEST-0001": ["B", "A"] }} />);
    expect(container.querySelector(".choice-chip")?.textContent).toBe("A");
    expect(screen.getByText("A が誤りの理由です。")).toBeTruthy();
  });
});

describe("ChoiceReview", () => {
  it("正解と自分の誤答を_色とタグの文字で示す", () => {
    const { container } = render(<ChoiceReview question={question as never} selected={["B"]} />);
    const rows = [...container.querySelectorAll("li")];
    expect(rows.map((li) => li.getAttribute("data-state"))).toEqual(["correct", "wrong"]);
    expect(rows[0]?.textContent).toContain("正解");
    expect(rows[1]?.textContent).toContain("あなたの回答");
  });
});
