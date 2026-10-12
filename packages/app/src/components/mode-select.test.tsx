// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, loadSession, saveConditions } from "@/lib/storage.ts";
import type { PublishedExam } from "@/lib/types.ts";
import { ModeSelect } from "./mode-select.tsx";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const exam = {
  examCode: "TEST",
  name: "テスト資格",
  shortName: "TEST",
  officialQuestionCount: 3,
  officialTimeMinutes: 10,
  domains: [
    { code: "domain1", name: "分野 1", weight: 0.5 },
    { code: "domain2", name: "分野 2", weight: 0.5 },
  ],
} as PublishedExam;

const pool = [1, 2, 3, 4, 5].map((n) => ({
  questionId: `TEST-000${n}`,
  domain: n % 2 === 0 ? "domain2" : "domain1",
  questionType: "single" as const,
  choiceKeys: ["A", "B", "C"],
}));

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

describe("ModeSelect の本番モード", () => {
  it("本番の問題数と制限時間を示す", async () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    expect(await screen.findByText(/本番と同じ 3 問を、制限時間 10 分で解きます/)).toBeTruthy();
  });

  it("始める_分野の選択によらず本番の問題数で_締め切りつきの出題を保存して出題へ進む", async () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /分野 2/ }));
    await user.click(screen.getByRole("button", { name: "本番モードを始める" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/play"));
    const session = loadSession(browserStore(), "TEST");
    expect(session?.questionIds).toHaveLength(3);
    const deadline = Date.parse(session?.deadline ?? "");
    const started = Date.parse(session?.startedAt ?? "");
    expect(deadline - started).toBe(10 * 60_000);
  });

  it("自由記述を含む問題データ_本番モードには自由記述を出題しない", async () => {
    const freeText = [6, 7, 8].map((n) => ({
      questionId: `TEST-000${n}`,
      domain: "domain1",
      questionType: "free-text" as const,
      choiceKeys: [],
    }));
    render(<ModeSelect exam={exam} pool={[...freeText, ...pool]} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "本番モードを始める" }));

    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/play"));
    const ids = loadSession(browserStore(), "TEST")?.questionIds ?? [];
    expect(ids).toHaveLength(3);
    for (const id of ids) expect(freeText.map((q) => q.questionId)).not.toContain(id);
  });

  it("選択式の問題がない_本番モードを始めない", async () => {
    const freeText = [
      { questionId: "TEST-0006", domain: "domain1", questionType: "free-text" as const, choiceKeys: [] },
    ];
    render(<ModeSelect exam={exam} pool={freeText} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "本番モードを始める" }));

    expect(await screen.findByText("出題できる問題がありません。")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();
    expect(loadSession(browserStore(), "TEST")).toBeNull();
  });
});

describe("ModeSelect の解答の表示", () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
  });

  it("既定はまとめて最後に_1 問ごとを選ぶと出題の状態に含め_次の既定として覚える", async () => {
    const { unmount } = render(<ModeSelect exam={exam} pool={pool} />);
    const user = userEvent.setup();
    const end = await screen.findByRole("radio", { name: /まとめて最後に/ });
    expect((end as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("radio", { name: /1 問ごと/ }));
    await user.click(screen.getByRole("button", { name: "出題を始める" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/play"));
    expect(loadSession(browserStore(), "TEST")?.reveal).toBe("each");
    unmount();

    render(<ModeSelect exam={exam} pool={pool} />);
    await waitFor(() =>
      expect((screen.getByRole("radio", { name: /1 問ごと/ }) as HTMLInputElement).checked).toBe(true),
    );
  });

  it("本番モード_1 問ごとを選んでいても_まとめて最後に採点する", async () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("radio", { name: /1 問ごと/ }));
    await user.click(screen.getByRole("button", { name: /本番モードを始める/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/play"));
    expect(loadSession(browserStore(), "TEST")?.reveal).toBeUndefined();
  });
});

describe("ModeSelect の難易度と解答回数と条件の保存", () => {
  const graded = [
    {
      questionId: "TEST-0001",
      domain: "domain1",
      questionType: "single" as const,
      difficulty: "easy" as const,
      choiceKeys: ["A"],
    },
    {
      questionId: "TEST-0002",
      domain: "domain1",
      questionType: "single" as const,
      difficulty: "hard" as const,
      choiceKeys: ["A"],
    },
    {
      questionId: "TEST-0003",
      domain: "domain2",
      questionType: "single" as const,
      difficulty: "hard" as const,
      choiceKeys: ["A"],
    },
    { questionId: "TEST-0004", domain: "domain2", questionType: "single" as const, choiceKeys: ["A"] },
  ];

  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("難易度を選ぶ_その難易度の問題だけで出題し_難易度のない問題は出さない", async () => {
    render(<ModeSelect exam={exam} pool={graded} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /むずかしい/ }));
    expect(screen.getByRole("button", { name: /むずかしい/ }).getAttribute("aria-pressed")).toBe("true");
    await user.selectOptions(screen.getByRole("combobox", { name: "問題数" }), "2");
    await user.click(screen.getByRole("button", { name: "出題を始める" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/play"));
    expect(loadSession(browserStore(), "TEST")?.questionIds.sort()).toEqual(["TEST-0002", "TEST-0003"]);
  });

  it("解答回数の少ない問題を優先_回数の少ない問題が選ばれる", async () => {
    // 10 問のうち、0001〜0005 は 0 回、0006〜0010 は 9 回解いている
    const many = Array.from({ length: 10 }, (_, i) => ({
      questionId: `TEST-${String(i + 1).padStart(4, "0")}`,
      domain: "domain1",
      questionType: "single" as const,
      choiceKeys: ["A"],
    }));
    const stats = many.slice(5).map(({ questionId }) => ({ questionId, count: 9, recent: [] }));
    const fetchMock = vi.fn(async (url: string) =>
      url.startsWith("/api/history/stats")
        ? { ok: true, status: 200, json: async () => ({ stats }) }
        : { ok: false, status: 503, json: async () => ({}) },
    );
    vi.stubGlobal("fetch", fetchMock);
    // 乱数を固定すると、重みの大きい(回数の少ない)問題ほど、選ぶ順の値が大きくなる
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    render(<ModeSelect exam={exam} pool={many} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("checkbox", { name: /解答回数の少ない問題を優先する/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => u.startsWith("/api/history/stats"))).toBe(true));
    await act(async () => {
      await Promise.resolve();
    });
    await user.click(screen.getByRole("button", { name: "出題を始める" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/play"));
    expect(loadSession(browserStore(), "TEST")?.questionIds.sort()).toEqual(many.slice(0, 5).map((q) => q.questionId));
  });

  it("条件を資格ごとに保存し_次に開いたときに戻す", async () => {
    const first = render(<ModeSelect exam={exam} pool={graded} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: /やさしい/ }));
    await user.click(screen.getByRole("checkbox", { name: /分野 1/ }));
    await user.click(screen.getByRole("checkbox", { name: /解答回数の少ない問題を優先する/ }));
    await user.click(screen.getByRole("button", { name: "出題を始める" }));
    await waitFor(() => expect(push).toHaveBeenCalled());
    first.unmount();

    render(<ModeSelect exam={exam} pool={graded} />);
    await waitFor(() =>
      expect(screen.getByRole("button", { name: /やさしい/ }).getAttribute("aria-pressed")).toBe("true"),
    );
    expect((screen.getByRole("checkbox", { name: /分野 1/ }) as HTMLInputElement).checked).toBe(true);
    expect((screen.getByRole("checkbox", { name: /解答回数の少ない問題を優先する/ }) as HTMLInputElement).checked).toBe(
      true,
    );
  });

  it("復習の待ちがある_復習プールの項目に色と文字を付ける", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.startsWith("/api/history/review")
          ? { ok: true, status: 200, json: async () => ({ questionIds: ["TEST-0001"] }) }
          : { ok: false, status: 503, json: async () => ({}) },
      ),
    );
    render(<ModeSelect exam={exam} pool={graded} />);
    expect(await screen.findByText("復習の待ちがあります")).toBeTruthy();
    const label = screen.getByRole("radio", { name: /復習プール/ }).closest("label");
    expect(label?.className).toContain("bg-warn-bg");
  });

  it("前回の対象が読み込めない_全問に戻す", async () => {
    saveConditions(browserStore(), "TEST", {
      target: "review",
      domains: [],
      difficulties: [],
      count: 1,
      preferFewer: false,
      reveal: "end",
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
    render(<ModeSelect exam={exam} pool={graded} />);
    await waitFor(() =>
      expect((screen.getByRole("radio", { name: /すべての問題/ }) as HTMLInputElement).checked).toBe(true),
    );
  });
});
