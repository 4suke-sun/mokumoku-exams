// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, loadSession } from "@/lib/storage.ts";
import { type ReviewExam, ReviewView } from "./review-view.tsx";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const exams: ReviewExam[] = [
  {
    examCode: "EX-TST-XX",
    name: "テスト資格",
    questions: [1, 2, 3].map((n) => ({ questionId: `TEST-000${n}`, excerpt: `問題文 ${n}`, choiceKeys: ["A", "B"] })),
  },
  {
    examCode: "EX-OTH-XX",
    name: "ほかの資格",
    questions: [{ questionId: "OTHER-0001", excerpt: "別", choiceKeys: [] }],
  },
];

function stub(items: unknown[] | null, deleteOk = true) {
  const fetchMock = vi.fn(async (url: string, init?: { method?: string }) => {
    if (init?.method === "DELETE") return { ok: deleteOk, status: deleteOk ? 200 : 503, json: async () => ({}) };
    if (url === "/api/history/review/all" && items) return { ok: true, status: 200, json: async () => ({ items }) };
    return { ok: false, status: 503, json: async () => ({}) };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ReviewView", () => {
  const items = [
    { examCode: "EX-TST-XX", questionId: "TEST-0001", streak: 1, mastered: false },
    { examCode: "EX-TST-XX", questionId: "TEST-0002", streak: 0, mastered: false },
    { examCode: "EX-TST-XX", questionId: "TEST-0003", streak: 2, mastered: true },
    { examCode: "EX-TST-XX", questionId: "TEST-0099", streak: 0, mastered: false },
  ];

  it("資格ごとに_未マスターの問題と連続正解の数_マスター済みの数を出す_データにない問題は出さない", async () => {
    stub(items);
    render(<ReviewView exams={exams} />);
    expect(await screen.findByText("待ち 2 問 / マスター済み 1 問")).toBeTruthy();
    expect(screen.getByText("問題文 1")).toBeTruthy();
    expect(screen.getByText("TEST-0001 / 連続正解 1 / 2")).toBeTruthy();
    expect(screen.queryByText("問題文 3")).toBeNull();
    expect(screen.queryByText("ほかの資格")).toBeNull();
    // 非公開にした問題も、いまのデータにない ID と同じに扱う: ID も、一覧にも「外す」ボタンにも出さない
    expect(document.body.textContent ?? "").not.toContain("TEST-0099");
    expect(screen.queryByRole("button", { name: /TEST-0099/ })).toBeNull();
  });

  it("復習する_待ちの問題だけで出題を始める", async () => {
    stub(items);
    render(<ReviewView exams={exams} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "復習する(2 問)" }));
    expect(push).toHaveBeenCalledWith("/exams/EX-TST-XX/play");
    expect(loadSession(browserStore(), "EX-TST-XX")?.questionIds).toEqual(["TEST-0001", "TEST-0002"]);
  });

  it("外す_一覧から消え_外せなかったときは知らせる", async () => {
    const fetchMock = stub(items);
    render(<ReviewView exams={exams} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "TEST-0002を復習から外す" }));
    await waitFor(() => expect(screen.queryByText("問題文 2")).toBeNull());
    const sent = fetchMock.mock.calls.find(([, init]) => init?.method === "DELETE");
    const init = sent?.[1] as { body?: string } | undefined;
    expect(JSON.parse(String(init?.body))).toEqual({
      examCode: "EX-TST-XX",
      questionId: "TEST-0002",
    });
    expect((await screen.findByRole("status")).textContent).toContain("外しました");
  });

  it("待ちがない_空の案内を出す_読み込めない_エラーを出す", async () => {
    stub([]);
    const { unmount } = render(<ReviewView exams={exams} />);
    expect(await screen.findByText("復習を待っている問題はありません")).toBeTruthy();
    unmount();
    stub(null);
    render(<ReviewView exams={exams} />);
    expect((await screen.findByRole("alert")).textContent).toContain("読み込めませんでした");
  });
});
