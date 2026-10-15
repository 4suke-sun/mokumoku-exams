// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, saveSession } from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { PlayLoader } from "./play-loader.tsx";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const served = vi.hoisted(() => ({
  calls: [] as string[][],
  questions: [] as Question[] | null,
}));
vi.mock("@/lib/questions/client.ts", () => ({
  fetchQuestions: async (_examCode: string, ids: readonly string[]) => {
    served.calls.push([...ids]);
    return served.questions === null ? null : served.questions.filter((q) => ids.includes(q.questionId));
  },
}));

const exam = { examCode: "TEST", name: "テスト資格", shortName: "TEST" } as PublishedExam;
const question = (n: number) =>
  ({
    questionId: `TEST-000${n}`,
    examCode: "TEST",
    domain: "domain1",
    questionType: "single",
    questionText: `問題文 ${n}`,
    choices: [
      { key: "A", text: "選択肢 1" },
      { key: "B", text: "選択肢 2" },
    ],
    correctAnswers: ["A"],
    explanation: "解説",
  }) as Question;

beforeEach(() => {
  localStorage.clear();
  served.calls = [];
  served.questions = [question(1), question(2), question(3)];
});

afterEach(() => {
  cleanup();
});

describe("PlayLoader", () => {
  it("出題中_出題の問題だけを取って出題を始める", async () => {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: ["TEST-0002", "TEST-0001"],
      answers: {},
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
    });
    render(<PlayLoader exam={exam} />);
    expect(await screen.findByText("問題文 2")).toBeTruthy();
    expect(served.calls).toEqual([["TEST-0002", "TEST-0001"]]);
  });

  it("出題の状態がない_問題を求めずに_出題がない表示にする", async () => {
    render(<PlayLoader exam={exam} />);
    expect(await screen.findByRole("link", { name: /モード選択/ })).toBeTruthy();
    expect(served.calls).toEqual([]);
    expect(screen.queryByText(/問題文/)).toBeNull();
  });

  it("問題を取れない_失敗を示して_モード選択へ戻る道を出す", async () => {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: ["TEST-0001"],
      answers: {},
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
    });
    served.questions = null;
    render(<PlayLoader exam={exam} />);
    expect((await screen.findByRole("alert")).textContent).toContain("問題を読み込めませんでした");
    expect(screen.getByRole("link", { name: "モード選択へ戻る" })).toBeTruthy();
  });
});
