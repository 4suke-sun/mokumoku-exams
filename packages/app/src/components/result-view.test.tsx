// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, loadResults, type Result, saveResult } from "@/lib/storage.ts";
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

  it("保存した結果が複数ある_問題ごとに直近の正誤を新しい順に表示する", async () => {
    saveResult(browserStore(), {
      examCode: "TEST",
      questionIds: ["TEST-0001"],
      answers: { "TEST-0001": ["B"] },
      finishedAt: "2026-10-09T00:00:00.000Z",
    });
    // 新しい結果(1 問目は正解、2 問目は不正解)
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["B"], "TEST-0003": ["B"] });
    render(<ResultView exam={exam} questions={questions} />);

    const first = await screen.findByRole("list", { name: "直近 2 回の正誤(新しい順)" });
    expect(Array.from(first.querySelectorAll("li")).map((li) => li.textContent)).toEqual(["○正解", "×不正解"]);
    // 1 回だけ解いた問題は、その 1 回だけ
    expect(screen.getAllByRole("list", { name: "直近 1 回の正誤(新しい順)" })).toHaveLength(2);
  });
});

describe("ResultView のアカウントへの保存", () => {
  const serverResult = (finishedAt: string, answers: Record<string, string[]>): Result => ({
    examCode: "TEST",
    questionIds: questions.map((q) => q.questionId),
    answers,
    finishedAt,
  });

  /** GET はサーバーの結果を返し、POST は postOk に従う。 */
  function stubServer(server: Result[] | null, postOk = true) {
    const fetchMock = vi.fn(async (_url: string, init?: { method?: string }) => {
      if (init?.method === "POST") return { ok: postOk, status: postOk ? 200 : 503, json: async () => ({}) };
      if (server === null) return { ok: false, status: 503, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ results: server }) };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("サーバーに結果がある_その結果を表示し_移行の案内は出さない", async () => {
    stubServer([
      serverResult("2026-10-11T00:00:00.000Z", { "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["B"] }),
    ]);
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText(/3 問中 3 問が正解/)).toBeTruthy();
    expect(screen.queryByText(/この端末にだけ残っている記録/)).toBeNull();
    expect(screen.queryByText(/サーバーに接続できない/)).toBeNull();
  });

  it("サーバーに接続できない_この端末の記録を表示し_その旨を伝える", async () => {
    stubServer(null);
    saveAnswers({ "TEST-0001": ["A"] });
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText(/サーバーに接続できないため/)).toBeTruthy();
    expect(screen.getByText(/3 問中 1 問が正解/)).toBeTruthy();
  });

  it("この端末にだけ記録がある_件数を案内し_移すとサーバーへ送って端末の記録を消す", async () => {
    const fetchMock = stubServer([]);
    saveAnswers({ "TEST-0001": ["A"] });
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText(/この端末にだけ残っている記録が 1 件/)).toBeTruthy();

    await userEvent.setup().click(screen.getByRole("button", { name: "アカウントに移す" }));
    await waitFor(() => expect(screen.queryByText(/この端末にだけ残っている記録/)).toBeNull());
    const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(loadResults(browserStore(), "TEST")).toHaveLength(0);
  });

  it("移すのに失敗した_端末の記録を残し_やり直せる", async () => {
    stubServer([], false);
    saveAnswers({ "TEST-0001": ["A"] });
    render(<ResultView exam={exam} questions={questions} />);
    await userEvent.setup().click(await screen.findByRole("button", { name: "アカウントに移す" }));
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(loadResults(browserStore(), "TEST")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "アカウントに移す" })).toBeTruthy();
  });

  it("サーバーに同じ完了時刻の記録がある_端末の記録は移行の対象にしない", async () => {
    stubServer([serverResult("2026-10-10T00:00:00.000Z", { "TEST-0001": ["A"] })]);
    saveAnswers({ "TEST-0001": ["A"] });
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText(/3 問中 1 問が正解/)).toBeTruthy();
    expect(screen.queryByText(/この端末にだけ残っている記録/)).toBeNull();
  });
});
