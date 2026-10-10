// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, saveResult } from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { ResultView } from "./result-view.tsx";

const exam = {
  examCode: "TEST",
  name: "テスト資格",
  shortName: "TEST",
  passingScore: 720,
  totalScore: 1000,
} as PublishedExam;

function question(id: number, correct: string): Question {
  return {
    questionId: `TEST-000${id}`,
    examCode: "TEST",
    domain: "domain1",
    questionType: "single",
    questionText: `問題文 ${id}`,
    choices: [
      { key: "A", text: "選択肢 1" },
      { key: "B", text: "選択肢 2" },
    ],
    correctAnswers: [correct],
    explanation: `解説 ${id}`,
  } as Question;
}

const questions = [question(1, "A"), question(2, "A"), question(3, "B")];

beforeEach(() => {
  localStorage.clear();
  // 動きを減らす設定にして、カウントアップを待たずに最終の値を見る
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function saveAnswers(answers: Record<string, string[]>) {
  saveResult(browserStore(), {
    examCode: "TEST",
    questionIds: questions.map((q) => q.questionId),
    answers,
    finishedAt: "2026-10-10T00:00:00.000Z",
  });
}

describe("ResultView", () => {
  it("結果がない_案内を表示する", async () => {
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText("結果がありません")).toBeTruthy();
  });

  it("2 問が不正解_正答率と_間違えた問題の数を表示する", async () => {
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["B"], "TEST-0003": ["A"] });
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByRole("img", { name: "正答率 33.3%" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "間違えた問題だけを見直す(2 問)" })).toBeTruthy();
    expect(screen.getAllByRole("listitem").length).toBeGreaterThanOrEqual(3);
  });

  it("間違えた問題だけを見直す_誤答だけが元の問題番号で並び_戻せる", async () => {
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["B"], "TEST-0003": ["A"] });
    render(<ResultView exam={exam} questions={questions} />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: /間違えた問題だけを見直す/ }));
    expect(screen.queryByText("問題文 1")).toBeNull();
    expect(screen.getByText("問題文 2")).toBeTruthy();
    expect(screen.getByText("問題文 3")).toBeTruthy();
    const marks = screen.getAllByText(/^問題 \d$/).map((el) => el.textContent);
    expect(marks).toEqual(["問題 2", "問題 3"]);

    await user.click(screen.getByRole("button", { name: "すべての問題を表示する" }));
    expect(screen.getByText("問題文 1")).toBeTruthy();
  });

  it("すべて正解_見直しの切り替えは出さず_その旨を表示する", async () => {
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["B"] });
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText("すべて正解でした。見直す問題はありません。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /見直す/ })).toBeNull();
    // 3 問すべてが、一覧に並んでいる
    expect(screen.getAllByText(/^問題 \d$/)).toHaveLength(3);
  });
});
