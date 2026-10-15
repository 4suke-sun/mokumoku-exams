// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { BookmarkCheck } from "./bookmark-check.tsx";

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

const questions = [question(1, "A"), question(2, "B"), question(3, "A")];

const order = questions.map((q) => q.questionId);

/**
 * ブックマークの取得に、渡した問題 ID を返す。null は失敗(503)。問題の取得には、指定された ID の問題を返す。
 * ほかの送信(ブックマークの付け外し)は、成功にする。
 */
function stubBookmarks(ids: string[] | null, pool: readonly Question[] = questions) {
  const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/questions") {
        const wanted: string[] = JSON.parse(String(init?.body)).questionIds;
        return ok({ questions: pool.filter((q) => wanted.includes(q.questionId)) });
      }
      if (url.startsWith("/api/history/bookmarks?"))
        return ids ? ok({ questionIds: ids }) : { ok: false, status: 503, json: async () => ({}) };
      return ok({});
    }),
  );
}

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("直前チェック", () => {
  it("一覧_ブックマークした問題を_正解と解説つきで並べる", async () => {
    stubBookmarks(["TEST-0001", "TEST-0003"]);
    render(<BookmarkCheck exam={exam} order={order} />);
    expect(await screen.findByText("問題文 1")).toBeTruthy();
    expect(screen.getByText("問題文 3")).toBeTruthy();
    expect(screen.queryByText("問題文 2")).toBeNull();
    expect(screen.getByText("解説 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "一覧" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("カードに切り替える_表は問題だけで_めくると正解と解説を出す", async () => {
    stubBookmarks(["TEST-0001", "TEST-0003"]);
    render(<BookmarkCheck exam={exam} order={order} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "カード" }));
    expect(screen.getByText("1 / 2 問目")).toBeTruthy();
    expect(screen.getByText("問題文 1")).toBeTruthy();
    expect(screen.queryByText("問題文 3")).toBeNull();
    expect(screen.queryByText("正解")).toBeNull();
    expect(screen.queryByText("解説 1")).toBeNull();

    await user.click(screen.getByRole("button", { name: "めくって正解を見る" }));
    expect(screen.getByText("正解")).toBeTruthy();
    expect(screen.getByText("解説 1")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "問題に戻す" }));
    expect(screen.queryByText("解説 1")).toBeNull();
  });

  it("カードの次へと前へ_問題を移り_表に戻る_端では押せない", async () => {
    stubBookmarks(["TEST-0001", "TEST-0003"]);
    render(<BookmarkCheck exam={exam} order={order} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "カード" }));
    const prev = screen.getByRole("button", { name: "前へ" });
    const next = screen.getByRole("button", { name: "次へ" });
    expect(prev.hasAttribute("disabled")).toBe(true);

    await user.click(screen.getByRole("button", { name: "めくって正解を見る" }));
    await user.click(next);
    expect(screen.getByText("2 / 2 問目")).toBeTruthy();
    expect(screen.getByText("問題文 3")).toBeTruthy();
    expect(screen.queryByText("解説 3")).toBeNull();
    expect(next.hasAttribute("disabled")).toBe(true);

    await user.click(prev);
    expect(screen.getByText("問題文 1")).toBeTruthy();
  });

  it("一覧に戻す_すべての問題を正解と解説つきで出す", async () => {
    stubBookmarks(["TEST-0001", "TEST-0003"]);
    render(<BookmarkCheck exam={exam} order={order} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "カード" }));
    await user.click(screen.getByRole("button", { name: "一覧" }));
    expect(screen.getByText("問題文 3")).toBeTruthy();
    expect(screen.getByText("解説 3")).toBeTruthy();
  });

  it("出典のある問題_めくると解説と一緒に出典のリンクを出す", async () => {
    const withReference = { ...question(1, "A"), references: [{ url: "https://www.nist.gov/itl" }] } as Question;
    stubBookmarks(["TEST-0001"], [withReference]);
    render(<BookmarkCheck exam={exam} order={[withReference.questionId]} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "カード" }));
    expect(screen.queryByRole("link", { name: /www\.nist\.gov/ })).toBeNull();
    await user.click(screen.getByRole("button", { name: "めくって正解を見る" }));
    const link = screen.getByRole("link", { name: "www.nist.gov(外部サイト)" });
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("ブックマークがない_案内を出し_形式の切り替えは出さない", async () => {
    stubBookmarks([]);
    render(<BookmarkCheck exam={exam} order={order} />);
    expect(await screen.findByText(/ブックマークした問題はありません/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "カード" })).toBeNull();
  });

  it("ブックマークを読み込めない_読み込みの案内を出す", async () => {
    stubBookmarks(null);
    render(<BookmarkCheck exam={exam} order={order} />);
    await waitFor(() => expect(fetch).toHaveBeenCalled());
    expect(screen.getByText(/ブックマークを読み込んでいます/)).toBeTruthy();
  });
});

describe("直前チェックの問題の取得", () => {
  it("ブックマークを読み込めた_ブックマークした問題だけを取る", async () => {
    stubBookmarks(["TEST-0003", "TEST-0001"]);
    render(<BookmarkCheck exam={exam} order={order} />);
    expect(await screen.findByText("問題文 1")).toBeTruthy();
    const calls = (fetch as unknown as { mock: { calls: [string, RequestInit?][] } }).mock.calls;
    const asked = calls.filter(([url]) => url === "/api/questions").map(([, init]) => JSON.parse(String(init?.body)));
    expect(asked).toEqual([{ examCode: "TEST", questionIds: ["TEST-0001", "TEST-0003"] }]);
  });
});
