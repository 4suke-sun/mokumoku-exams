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

/** モードのカードを選ぶ(出題の設定は、選んだあとに出る) */
async function chooseMode(user: ReturnType<typeof userEvent.setup>, name: string | RegExp = "通常出題") {
  await user.click(await screen.findByRole("button", { name }));
}

describe("ModeSelect の本番モード", () => {
  it("本番の問題数と制限時間を示す", async () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    expect(await screen.findByText(/本番と同じ 3 問を、制限時間 10 分で解きます/)).toBeTruthy();
  });

  it("始める_分野の選択によらず本番の問題数で_締め切りつきの出題を保存して出題へ進む", async () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    const user = userEvent.setup();
    await chooseMode(user);
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
    await chooseMode(user);
    const end = await screen.findByRole("radio", { name: /まとめて最後に/ });
    expect((end as HTMLInputElement).checked).toBe(true);

    await user.click(screen.getByRole("radio", { name: /1 問ごと/ }));
    await user.click(screen.getByRole("button", { name: "出題を始める" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/play"));
    expect(loadSession(browserStore(), "TEST")?.reveal).toBe("each");
    unmount();

    render(<ModeSelect exam={exam} pool={pool} />);
    await chooseMode(userEvent.setup());
    await waitFor(() =>
      expect((screen.getByRole("radio", { name: /1 問ごと/ }) as HTMLInputElement).checked).toBe(true),
    );
  });

  it("本番モード_1 問ごとを選んでいても_まとめて最後に採点する", async () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    const user = userEvent.setup();
    await chooseMode(user);
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
    await chooseMode(user);
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
    await chooseMode(user);
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
    await chooseMode(user);
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
    const card = screen.getByRole("button", { name: "復習" }).closest("li");
    expect(card?.className).toContain("bg-warn-bg");
    expect(card?.textContent).toContain("待ち 1 問");
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

describe("ModeSelect のモードのカード", () => {
  beforeEach(() => {
    localStorage.clear();
    push.mockClear();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("開いたとき_全モードのカードを並べ_出題の設定はまだ出さない", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ questionIds: [] }) })),
    );
    const withFreeText = [
      ...pool,
      { questionId: "TEST-0009", domain: "domain1", questionType: "free-text" as const, choiceKeys: [] },
    ];
    render(<ModeSelect exam={exam} pool={withFreeText} studyUnits={4} />);
    for (const name of ["通常出題", "復習", "自由記述"]) {
      expect(await screen.findByRole("button", { name })).toBeTruthy();
    }
    expect(screen.getByRole("link", { name: "直前チェック(ブックマーク)" }).getAttribute("href")).toBe("/bookmarks");
    expect(screen.getByRole("link", { name: "学習モード" }).getAttribute("href")).toBe("/exams/TEST/study");
    expect(screen.getByRole("link", { name: "セクションで解く" }).getAttribute("href")).toBe("/exams/TEST/sections");
    expect(screen.getByRole("button", { name: "本番モードを始める" })).toBeTruthy();
    expect(screen.getByText("2 分野・4 単元")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "出題を始める" })).toBeNull();
    expect(screen.queryByRole("checkbox", { name: /分野 1/ })).toBeNull();
  });

  it("カードを選ぶ_押した状態を示し_そのモードの設定を出す", async () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    const user = userEvent.setup();
    const card = await screen.findByRole("button", { name: "通常出題" });
    expect(card.getAttribute("aria-pressed")).toBe("false");
    await user.click(card);
    expect(screen.getByRole("button", { name: /通常出題/ }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("heading", { name: "通常出題の設定" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "出題を始める" })).toBeTruthy();
  });

  it("自由記述のカード_自由記述の問題だけで出題する", async () => {
    const mixed = [
      { questionId: "TEST-0001", domain: "domain1", questionType: "single" as const, choiceKeys: ["A"] },
      { questionId: "TEST-0002", domain: "domain1", questionType: "free-text" as const, choiceKeys: [] },
      { questionId: "TEST-0003", domain: "domain2", questionType: "free-text" as const, choiceKeys: [] },
    ];
    render(<ModeSelect exam={exam} pool={mixed} />);
    const user = userEvent.setup();
    expect(await screen.findByText("2 問")).toBeTruthy();
    await chooseMode(user, "自由記述");
    await user.selectOptions(screen.getByRole("combobox", { name: "問題数" }), "2");
    await user.click(screen.getByRole("button", { name: "出題を始める" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/play"));
    expect(loadSession(browserStore(), "TEST")?.questionIds.sort()).toEqual(["TEST-0002", "TEST-0003"]);
  });

  it("自由記述の問題がない_カードを選べない", async () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    expect(await screen.findByText(/自由記述の問題がありません/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "自由記述" })).toBeNull();
  });

  it("要約カードがある_入口と枚数を出し_ブックマークの直前チェックと名前を付け分ける", async () => {
    render(<ModeSelect exam={exam} pool={pool} summaryCount={50} />);
    const link = await screen.findByRole("link", { name: "直前チェック(要約カード)" });
    expect(link.getAttribute("href")).toBe("/exams/TEST/cards");
    expect(screen.getByText("50 枚")).toBeTruthy();
    expect(screen.getByRole("link", { name: "直前チェック(ブックマーク)" }).getAttribute("href")).toBe("/bookmarks");
  });

  it("要約カードがない資格_入口を出さない", async () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    await screen.findByRole("button", { name: "通常出題" });
    expect(screen.queryByRole("link", { name: /要約カード/ })).toBeNull();
    expect(screen.getByRole("link", { name: "直前チェック(ブックマーク)" })).toBeTruthy();
  });

  it("カリキュラムがない_学習モードは準備中", async () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    expect(await screen.findByText(/単元ごとに読んでから解きます。\(準備中です\)/)).toBeTruthy();
    expect(screen.queryByRole("link", { name: "学習モード" })).toBeNull();
  });
});

describe("ModeSelect のシャッフルの設定", () => {
  it("シャッフルを切り替える_端末に保存し_アカウントにも送る", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: { method?: string; body?: string }) => ({
      ok: true,
      status: 200,
      json: async () => ({}),
    }));
    vi.stubGlobal("fetch", fetchMock);
    render(<ModeSelect exam={exam} pool={pool} />);
    const user = userEvent.setup();
    await chooseMode(user);
    await user.click(await screen.findByRole("checkbox", { name: /選択肢の並びをシャッフルする/ }));
    const put = fetchMock.mock.calls.find(([url, init]) => url === "/api/history/prefs" && init?.method === "PUT");
    expect(JSON.parse(put?.[1]?.body ?? "{}")).toEqual({ theme: "system", style: "rich", shuffleChoices: true });
    vi.unstubAllGlobals();
  });
});

describe("ModeSelect の見出しの導線", () => {
  it("試験の情報へのリンクを出す", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
    render(<ModeSelect exam={exam} pool={pool} />);
    expect((await screen.findByRole("link", { name: "試験の情報" })).getAttribute("href")).toBe("/exams/TEST/info");
    vi.unstubAllGlobals();
  });
});

describe("ModeSelect の見出し", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("資格コード・合格ライン・問題数と_使い方へのリンクを出す", async () => {
    const withLine = { ...exam, passingScore: 720, totalScore: 1000 } as PublishedExam;
    render(<ModeSelect exam={withLine} pool={pool} />);
    const info = await screen.findByRole("list", { name: "資格の情報" });
    expect(info.textContent).toContain("TEST");
    expect(info.textContent).toContain("合格ライン 72%");
    expect(info.textContent).toContain("問題 5 問");
    expect(screen.getByRole("link", { name: "使い方" }).getAttribute("href")).toBe("/help");
  });

  it("問題が本番の数に届かない_注記を出す", async () => {
    render(<ModeSelect exam={{ ...exam, officialQuestionCount: 85 } as PublishedExam} pool={pool} />);
    expect(await screen.findByText(/本番の 85 問に届いていません/)).toBeTruthy();
  });

  it("問題が本番の数に届いている_注記を出さない", async () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    await screen.findByRole("list", { name: "資格の情報" });
    expect(screen.queryByText(/届いていません/)).toBeNull();
  });
});
