// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, loadSession, saveResult } from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { BookmarkError, BookmarkToggle, useBookmarks } from "./bookmark-toggle.tsx";
import { DashboardView } from "./dashboard-view.tsx";
import { ModeSelect } from "./mode-select.tsx";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const exam = {
  examCode: "TEST",
  name: "テスト資格",
  shortName: "TEST",
  passingScore: 700,
  totalScore: 1000,
  domains: [{ code: "domain1", name: "分野 1", weight: 1 }],
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
const pool = questions.map((q) => ({
  questionId: q.questionId,
  domain: q.domain,
  questionType: q.questionType,
  choiceKeys: ["A", "B"],
}));

type Server = { bookmarks?: string[] | null; review?: string[] | null; results?: unknown[] | null; putOk?: boolean };

/** 経路ごとに応答を決める。null は失敗(503)。 */
function stubServer(server: Server) {
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    const fail = { ok: false, status: 503, json: async () => ({}) };
    const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
    if (init?.method === "PUT") return server.putOk === false ? fail : ok({ status: "saved" });
    if (url.startsWith("/api/history/bookmarks"))
      return server.bookmarks ? ok({ questionIds: server.bookmarks }) : fail;
    if (url.startsWith("/api/history/review")) return server.review ? ok({ questionIds: server.review }) : fail;
    if (url.startsWith("/api/history/results")) return server.results ? ok({ results: server.results }) : fail;
    return fail;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  push.mockReset();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** 画面のどこかに、その文字列があるか(括弧などを含む文面を、そのまま確かめる) */
const pageText = () => document.body.textContent ?? "";

function Toggle() {
  const bookmarks = useBookmarks("TEST");
  return (
    <>
      <BookmarkToggle questionId="TEST-0001" bookmarks={bookmarks} />
      <BookmarkError bookmarks={bookmarks} />
    </>
  );
}

describe("ブックマークの切り替え", () => {
  it("押す_付いた表示になり_資格と問題 ID と付ける向きを送る", async () => {
    const fetchMock = stubServer({ bookmarks: [] });
    render(<Toggle />);
    const button = await screen.findByRole("button", { name: /ブックマーク/ });
    await waitFor(() => expect(button.hasAttribute("disabled")).toBe(false));
    await userEvent.setup().click(button);
    await waitFor(() => expect(button.getAttribute("aria-pressed")).toBe("true"));
    const put = fetchMock.mock.calls.find(([, init]) => init?.method === "PUT") as [string, { body: string }];
    expect(JSON.parse(put[1].body)).toEqual({
      examCode: "TEST",
      questionId: "TEST-0001",
      bookmarked: true,
    });
  });

  it("保存に失敗する_元の表示に戻し_知らせる", async () => {
    stubServer({ bookmarks: ["TEST-0001"], putOk: false });
    render(<Toggle />);
    const button = await screen.findByRole("button", { name: /ブックマーク中/ });
    await userEvent.setup().click(button);
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(button.getAttribute("aria-pressed")).toBe("true");
  });

  it("ブックマークを読み込めない_押せない", async () => {
    const fetchMock = stubServer({ bookmarks: null });
    render(<Toggle />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /ブックマーク/ }).hasAttribute("disabled")).toBe(true);
  });
});

describe("モード選択の出題の対象", () => {
  it("復習プールを選ぶ_プールの問題だけで出題する(いまのデータにない問題は落とす)", async () => {
    stubServer({ review: ["TEST-0002", "TEST-0099"], bookmarks: [] });
    render(<ModeSelect exam={exam} pool={pool} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "通常出題" }));
    const review = await screen.findByRole("radio", { name: /復習プール/ });
    await waitFor(() => expect(review.hasAttribute("disabled")).toBe(false));
    expect(screen.getByText(/復習プール/).textContent).toContain("1 問");
    await user.click(review);
    await user.click(screen.getByRole("button", { name: "出題を始める" }));
    expect(loadSession(browserStore(), "TEST")?.questionIds).toEqual(["TEST-0002"]);
    expect(push).toHaveBeenCalledWith("/exams/TEST/play");
  });

  it("ブックマークが空_選べるが出題できず_案内を出す", async () => {
    stubServer({ review: [], bookmarks: [] });
    render(<ModeSelect exam={exam} pool={pool} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "通常出題" }));
    const bookmarks = await screen.findByRole("radio", { name: /ブックマーク/ });
    await waitFor(() => expect(bookmarks.hasAttribute("disabled")).toBe(false));
    await user.click(bookmarks);
    expect(screen.getByText("選んだ条件に合う問題がありません。")).toBeTruthy();
    expect(screen.getByRole("button", { name: "出題を始める" }).hasAttribute("disabled")).toBe(true);
  });

  it("アカウントから読み込めない_復習プールとブックマークは選べない", async () => {
    const fetchMock = stubServer({ review: null, bookmarks: null });
    render(<ModeSelect exam={exam} pool={pool} />);
    // 復習プール、ブックマーク、解答回数(優先の選び方に使う)の 3 つを取りに行く
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    // 復習のカードは選べない。通常出題の設定の中では、復習プールとブックマークの対象が選べない
    await waitFor(() => expect(screen.getAllByText(/いまは選べません/)).toHaveLength(1));
    expect(screen.queryByRole("button", { name: "復習" })).toBeNull();
    await userEvent.setup().click(screen.getByRole("button", { name: "通常出題" }));
    expect(screen.getAllByText(/いまは選べません/)).toHaveLength(3);
    expect(screen.getByRole("radio", { name: /復習プール/ }).hasAttribute("disabled")).toBe(true);
  });
});

describe("学習の状況", () => {
  const result = (finishedAt: string, answers: Record<string, string[]>) => ({
    examCode: "TEST",
    questionIds: questions.map((q) => q.questionId),
    answers,
    finishedAt,
  });

  it("結果がある_直近の平均で合格予測を出し_学習量と見直す問題の数を表示する", async () => {
    stubServer({
      results: [
        result("2026-10-11T01:00:00.000Z", { "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["B"] }),
        result("2026-10-11T00:00:00.000Z", { "TEST-0001": ["A"] }),
      ],
      review: ["TEST-0002"],
      bookmarks: ["TEST-0001", "TEST-0003"],
    });
    render(<DashboardView exam={exam} questions={questions} />);
    // (100 + 33.3) / 2 = 66.7%。合格ラインは 70%
    await waitFor(() => expect(pageText()).toContain("合格ライン(70%)まで、あと 3.3 ポイントです。"));
    expect(pageText()).toContain("直近 2 回(最大 10 回)の結果を分野ごとに集計し");
    expect(screen.getByText("2 回")).toBeTruthy();
    expect(screen.getByText("6 問")).toBeTruthy();
    expect(screen.getByText(/復習プール: 1 問/)).toBeTruthy();
    expect(screen.getByText(/ブックマーク: 2 問/)).toBeTruthy();
  });

  it("サーバーに接続できない_この端末の記録で表示し_その旨を伝える", async () => {
    stubServer({ results: null, review: null, bookmarks: null });
    saveResult(
      browserStore(),
      result("2026-10-11T00:00:00.000Z", { "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["B"] }),
    );
    render(<DashboardView exam={exam} questions={questions} />);
    expect(await screen.findByText(/この端末に保存した記録で表示しています/)).toBeTruthy();
    expect(pageText()).toContain("合格ライン(70%)に届く見込みです。");
    expect(screen.getByText(/復習プール: 読み込めませんでした/)).toBeTruthy();
  });

  it("結果がない_案内を表示し_合格予測は出さない", async () => {
    stubServer({ results: [], review: [], bookmarks: [] });
    render(<DashboardView exam={exam} questions={questions} />);
    expect(await screen.findByText("この資格の結果がありません")).toBeTruthy();
    expect(screen.queryByText(/ここに/)).toBeNull();
    expect(screen.queryByText("合格予測")).toBeNull();
  });
});
