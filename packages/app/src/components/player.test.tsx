// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, loadResults, saveSession } from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { Player } from "./player.tsx";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const exam = { examCode: "TEST", name: "テスト資格", shortName: "TEST" } as PublishedExam;

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
      { key: "C", text: "選択肢 3" },
    ],
    correctAnswers: [correct],
    explanation: "解説",
  } as Question;
}

const questions = [question(1, "A"), question(2, "B")];

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
  saveSession(browserStore(), {
    examCode: "TEST",
    questionIds: questions.map((q) => q.questionId),
    answers: {},
    index: 0,
    startedAt: "2026-10-10T00:00:00.000Z",
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const checked = () => (screen.getAllByRole("radio") as HTMLInputElement[]).map((r) => r.checked);

describe("Player のキー操作", () => {
  it("選択肢のキーで選べて_回答していないうちは_Enter でも進まない", async () => {
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    expect(await screen.findByText("問題文 1")).toBeTruthy();

    await user.keyboard("{Enter}");
    expect(screen.getByText("問題文 1")).toBeTruthy();

    await user.keyboard("b");
    expect(checked()).toEqual([false, true, false]);
  });

  it("回答したあと_Enter か N で次へ進み_P で前に戻る", async () => {
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");

    await user.keyboard("a");
    await user.keyboard("{Enter}");
    expect(await screen.findByText("問題文 2")).toBeTruthy();
    expect(document.activeElement?.tagName).toBe("FIELDSET");

    await user.keyboard("p");
    expect(await screen.findByText("問題文 1")).toBeTruthy();
    expect(checked()).toEqual([true, false, false]);

    await user.keyboard("n");
    expect(await screen.findByText("問題文 2")).toBeTruthy();
  });

  it("最後の問題で回答して_Enter_採点して結果へ進む", async () => {
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");

    await user.keyboard("a{Enter}");
    await screen.findByText("問題文 2");
    await user.keyboard("b{Enter}");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/result"));
    // サーバーに接続できない(このテストの既定)ときは、この端末に残す
    expect(loadResults(browserStore(), "TEST")).toHaveLength(1);
  });

  it("採点でサーバーに保存できた_端末には残さずサーバーを正として結果へ進む", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ status: "saved" }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");
    await user.keyboard("a{Enter}");
    await screen.findByText("問題文 2");
    await user.keyboard("b{Enter}");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/result"));
    const posts = fetchMock.mock.calls.filter(([url]) => url === "/api/history/results");
    expect(posts).toHaveLength(1);
    const sent = JSON.parse(posts[0]?.[1].body);
    expect(sent.examCode).toBe("TEST");
    // 利用者の識別子は送らない(サーバーがトークンから決める)
    expect(Object.keys(sent)).not.toContain("sub");
    expect(loadResults(browserStore(), "TEST")).toHaveLength(0);
  });

  it("採点でサーバーが失敗した_この端末に残して結果へ進む", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }));
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");
    await user.keyboard("a{Enter}");
    await screen.findByText("問題文 2");
    await user.keyboard("b{Enter}");

    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/result"));
    expect(loadResults(browserStore(), "TEST")).toHaveLength(1);
  });

  it("保存の途中でもう一度採点を押した_サーバーへの保存は 1 回だけ", async () => {
    let release: (value: unknown) => void = () => {};
    const fetchMock = vi.fn().mockReturnValue(new Promise((resolve) => (release = resolve)));
    vi.stubGlobal("fetch", fetchMock);
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");
    await user.keyboard("a{Enter}");
    await screen.findByText("問題文 2");
    await user.keyboard("b");
    await user.click(screen.getByRole("button", { name: "採点する" }));
    await user.click(screen.getByRole("button", { name: "採点する" }));
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/history/results")).toHaveLength(1);
    release({ ok: true, status: 200, json: async () => ({}) });
    await waitFor(() => expect(push).toHaveBeenCalledTimes(1));
  });

  it("選択肢にないキー_何も起きない", async () => {
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");
    await user.keyboard("z");
    expect(checked()).toEqual([false, false, false]);
  });

  it("選択肢の並びをシャッフルしている_案内は小さいキーから大きいキーの範囲になる", async () => {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: questions.map((q) => q.questionId),
      answers: {},
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
      choiceOrder: { "TEST-0001": ["C", "A", "B"] },
    });
    render(<Player exam={exam} questions={questions} />);
    expect(await screen.findByText(/キー操作: A〜C で選ぶ/)).toBeTruthy();
    // 画面の並びは C, A, B だが、キーは元のまま選べる
    const user = userEvent.setup();
    await user.keyboard("a");
    expect(checked()).toEqual([false, true, false]);
  });

  it("画面に_キー操作の案内を表示する", async () => {
    render(<Player exam={exam} questions={questions} />);
    expect(await screen.findByText(/キー操作: A〜C で選ぶ/)).toBeTruthy();
  });
});
