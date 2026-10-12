// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserStore,
  loadResults,
  loadSession,
  type Result,
  type StageCheck,
  saveResult,
  saveSectionCheck,
  saveStageCheck,
} from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { ResultView } from "./result-view.tsx";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const exam = {
  examCode: "TEST",
  name: "テスト資格",
  shortName: "TEST",
  passingScore: 720,
  totalScore: 1000,
  domains: [
    { code: "domain1", name: "分野 1", weight: 0.6 },
    { code: "domain2", name: "分野 2", weight: 0.4 },
  ],
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
  push.mockClear();
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

  it("選択肢をシャッフルした結果_記号を上から振り直し_解説の記号と回答の表示もそれに合わせる", async () => {
    const shuffled = {
      ...question(1, "A"),
      explanation: "## 正解がAである理由は\n選択肢Bは誤り。",
    } as Question;
    saveResult(browserStore(), {
      examCode: "TEST",
      questionIds: [shuffled.questionId],
      answers: { [shuffled.questionId]: ["B"] },
      choiceOrder: { [shuffled.questionId]: ["B", "A"] },
      finishedAt: "2026-10-10T00:00:00.000Z",
    });
    render(<ResultView exam={exam} questions={[shuffled]} />);
    // 元のキーで B, A の順に並ぶので、画面では B が「A.」、A が「B.」になる
    expect(await screen.findByText("正解がBである理由は")).toBeTruthy();
    expect(screen.getByText("選択肢Aは誤り。")).toBeTruthy();
    expect(screen.getByText("あなたの回答: A / 正解: B")).toBeTruthy();
  });

  it("出典のある問題_解説のあとに出典のリンクを出す", async () => {
    const withReference = {
      ...question(1, "A"),
      references: [{ title: "公式の資料", url: "https://docs.aws.amazon.com/guide" }],
    } as Question;
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["B"] });
    render(<ResultView exam={exam} questions={[withReference, question(2, "A"), question(3, "B")]} />);
    const link = await screen.findByRole("link", { name: "公式の資料(外部サイト)" });
    expect(link.getAttribute("href")).toBe("https://docs.aws.amazon.com/guide");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getAllByRole("heading", { name: "出典" })).toHaveLength(1);
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

describe("ResultView の段階の確認問題", () => {
  const check = (over: Partial<StageCheck> = {}): StageCheck => ({
    unitId: "basics",
    order: 1,
    percent: 100,
    passed: true,
    finishedAt: "2026-10-10T00:00:00.000Z",
    ...over,
  });

  it("直近の結果が段階の確認で合格_合格を伝え_単元へ戻れる", async () => {
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["B"] });
    saveStageCheck(browserStore(), "TEST", check());
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText(/段階の確認問題に合格しました\(正答率 100%\)/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "単元へ戻る" }).getAttribute("href")).toBe("/exams/TEST/study/basics");
  });

  it("直近の結果が段階の確認で不合格_合格の基準と今回の正答率を伝える", async () => {
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["B"], "TEST-0003": ["A"] });
    saveStageCheck(browserStore(), "TEST", check({ percent: 33.3, passed: false }));
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText(/正答率 80% 以上で合格です\(今回は 33.3%\)/)).toBeTruthy();
  });

  it("段階の確認の記録が直近の結果のものではない_段階の合否を出さない", async () => {
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["B"] });
    saveStageCheck(browserStore(), "TEST", check({ finishedAt: "2026-10-09T00:00:00.000Z" }));
    render(<ResultView exam={exam} questions={questions} />);
    await screen.findByText("すべて正解でした。見直す問題はありません。");
    expect(screen.queryByText(/段階の確認問題/)).toBeNull();
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
    expect(
      screen.getByText("直近の結果は、アカウントに保存できませんでした。この端末にだけ残っています。"),
    ).toBeTruthy();

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

describe("ResultView の自由記述", () => {
  const freeText = {
    questionId: "TEST-0004",
    examCode: "TEST",
    domain: "domain1",
    questionType: "free-text",
    questionText: "記述の問題文",
    rubric: {
      criteria: [
        { name: "保存の観点", keywords: ["保存"], points: 60 },
        { name: "場所の観点", keywords: ["S3"], points: 40 },
      ],
      passingPoints: 60,
    },
    explanation: "記述の解説",
  } as Question;

  it("満たした観点と点数_回答と得点を表示し_合格点以上なら正解として数える", async () => {
    saveResult(browserStore(), {
      examCode: "TEST",
      questionIds: ["TEST-0004"],
      answers: {},
      textAnswers: { "TEST-0004": "ファイルを保存する" },
      finishedAt: "2026-10-10T00:00:00.000Z",
    });
    render(<ResultView exam={exam} questions={[freeText]} />);
    expect(await screen.findByRole("img", { name: "正答率 100%" })).toBeTruthy();
    expect(screen.getByText("ファイルを保存する")).toBeTruthy();
    expect(screen.getByText("○ 満たしている")).toBeTruthy();
    expect(screen.getByText("× 満たしていない")).toBeTruthy();
    expect(screen.getByText("60 / 60 点")).toBeTruthy();
    expect(screen.getByText("0 / 40 点")).toBeTruthy();
    expect(screen.getByText("得点: 60 / 100 点(合格点 60 点)")).toBeTruthy();
  });

  it("回答がない_未回答として表示し_不正解として数える", async () => {
    saveResult(browserStore(), {
      examCode: "TEST",
      questionIds: ["TEST-0004"],
      answers: {},
      finishedAt: "2026-10-10T00:00:00.000Z",
    });
    render(<ResultView exam={exam} questions={[freeText]} />);
    expect(await screen.findByRole("img", { name: "正答率 0%" })).toBeTruthy();
    expect(screen.getByText("未回答")).toBeTruthy();
    expect(screen.getByText("× 不正解")).toBeTruthy();
  });
});

describe("ResultView の解き直し", () => {
  it("間違えた問題だけで_新しい出題を始める", async () => {
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["B"], "TEST-0003": ["A"] });
    render(<ResultView exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "間違えた問題だけで解き直す(2 問)" }));
    expect(push).toHaveBeenCalledWith("/exams/TEST/play");
    const session = loadSession(browserStore(), "TEST");
    expect(session?.questionIds).toEqual(["TEST-0002", "TEST-0003"]);
    expect(session?.answers).toEqual({});
  });

  it("自信なしの問題_正解でも解き直しに含める", async () => {
    saveResult(browserStore(), {
      examCode: "TEST",
      questionIds: questions.map((q) => q.questionId),
      answers: { "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["A"] },
      finishedAt: "2026-10-10T00:00:00.000Z",
      unsure: [true, false, false],
      flagged: [false, true, false],
      timesMs: [65_000, 4_000, 0],
    });
    render(<ResultView exam={exam} questions={questions} />);
    const user = userEvent.setup();
    expect(await screen.findByText("自信なし")).toBeTruthy();
    expect(screen.getByText("見直し")).toBeTruthy();
    expect(screen.getByText("回答時間 1 分 5 秒")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "間違えた問題と自信なしの問題だけで解き直す(2 問)" }));
    expect(loadSession(browserStore(), "TEST")?.questionIds).toEqual(["TEST-0001", "TEST-0003"]);
  });

  it("間違いがない_解き直しのボタンを出さず_別の問題でもう一度はモード選択へ", async () => {
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["B"] });
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText("すべて正解でした。見直す問題はありません。")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /解き直す/ })).toBeNull();
    expect(screen.getByRole("link", { name: "別の問題でもう一度" }).getAttribute("href")).toBe("/exams/TEST");
  });
});

describe("ResultView の過去の結果とセクション", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("?at= で過去の 1 回分を開き_ほかの回は一覧に並ぶ", async () => {
    saveResult(browserStore(), {
      examCode: "TEST",
      questionIds: questions.map((q) => q.questionId),
      answers: { "TEST-0001": ["A"] },
      finishedAt: "2026-10-09T00:00:00.000Z",
    });
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["B"] });
    window.history.replaceState(null, "", `/exams/TEST/result?at=${encodeURIComponent("2026-10-09T00:00:00.000Z")}`);
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText(/3 問中 1 問が正解/)).toBeTruthy();
    expect(screen.getByText(/過去の結果/)).toBeTruthy();
    expect(screen.getByRole("link", { name: "最新の結果へ" })).toBeTruthy();
  });

  it("?at= の結果がない_見つからない旨を案内する", async () => {
    saveAnswers({ "TEST-0001": ["A"] });
    window.history.replaceState(null, "", "/exams/TEST/result?at=2020-01-01T00:00:00.000Z");
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByRole("heading", { name: "その回の結果は見つかりません" })).toBeTruthy();
  });

  it("直近がセクションの出題_合否と_次のセクションへのボタンを出す", async () => {
    saveAnswers({ "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["B"] });
    saveSectionCheck(browserStore(), "TEST", 0, { correct: 3, total: 3, finishedAt: "2026-10-10T00:00:00.000Z" });
    // 6 問あると、2 つ目のセクションがある
    const six = [...questions, ...[4, 5, 6].map((n) => ({ ...questions[0], questionId: `TEST-000${n}` }) as Question)];
    render(<ResultView exam={exam} questions={six} />);
    expect(await screen.findByText(/セクション 1 を満点で合格しました/)).toBeTruthy();
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /次のセクションへ/ }));
    expect(push).toHaveBeenCalledWith("/exams/TEST/play");
    const session = loadSession(browserStore(), "TEST");
    expect(session?.section).toBe(1);
    expect(session?.questionIds).toEqual(["TEST-0006"]);
  });
});

describe("ResultView の分野ごとの正答数と得点のカード", () => {
  const withTimes = (answers: Record<string, string[]>, timesMs?: number[]): Result => ({
    examCode: "TEST",
    questionIds: questions.map((q) => q.questionId),
    answers,
    finishedAt: "2026-10-10T00:00:00.000Z",
    ...(timesMs ? { timesMs } : {}),
  });

  it("分野ごとの正答数を出す_回答時間があれば分野ごとの平均も添える", async () => {
    saveResult(
      browserStore(),
      withTimes({ "TEST-0001": ["A"], "TEST-0002": ["B"], "TEST-0003": ["B"] }, [2000, 4000, 6000]),
    );
    render(<ResultView exam={exam} questions={questions} />);
    const bars = (await screen.findAllByRole("list", { name: "分野ごとの正答数" }))[0];
    expect(bars?.textContent).toContain("分野 1");
    expect(bars?.textContent).toContain("2 / 3 問(66.7%、平均 4 秒/問)");
    // 分野のない分野 2 は出題がないので出さない
    expect(bars?.textContent).not.toContain("分野 2");
  });

  it("シンプル表示のために_同じ内容の表も出す", async () => {
    saveResult(browserStore(), withTimes({ "TEST-0001": ["A"] }));
    render(<ResultView exam={exam} questions={questions} />);
    const table = await screen.findByRole("table", { name: "分野ごとの正答数" });
    expect(table.textContent).toContain("1 / 3 問(33.3%)");
  });

  it("回答時間がある_平均回答時間を出す", async () => {
    saveResult(browserStore(), withTimes({ "TEST-0001": ["A"] }, [1000, 2000, 6000]));
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText("平均回答時間 3 秒/問")).toBeTruthy();
  });

  it("回答時間のない古い結果_平均を出さず_崩れずに表示する", async () => {
    saveResult(browserStore(), withTimes({ "TEST-0001": ["A"], "TEST-0002": ["A"] }));
    render(<ResultView exam={exam} questions={questions} />);
    expect(await screen.findByText(/3 問中 2 問が正解/)).toBeTruthy();
    expect(screen.queryByText(/平均回答時間/)).toBeNull();
    expect(screen.queryByText(/回答時間 /)).toBeNull();
  });

  it("合格ラインに達している_色と文字の両方で伝える", async () => {
    saveResult(browserStore(), withTimes({ "TEST-0001": ["A"], "TEST-0002": ["A"], "TEST-0003": ["B"] }));
    render(<ResultView exam={exam} questions={questions} />);
    const label = await screen.findByText("合格ライン到達");
    expect(label.closest("div")?.className).toContain("bg-correct-bg");
  });

  it("合格ラインに達していない_色と文字の両方で伝える", async () => {
    saveResult(browserStore(), withTimes({ "TEST-0001": ["A"] }));
    render(<ResultView exam={exam} questions={questions} />);
    const label = await screen.findByText("合格ライン未達");
    expect(label.closest("div")?.className).toContain("bg-warn-bg");
  });

  it("問題ごとの結果_正誤の色の左の線を付ける", async () => {
    saveResult(browserStore(), withTimes({ "TEST-0001": ["A"], "TEST-0002": ["B"] }));
    render(<ResultView exam={exam} questions={questions} />);
    await screen.findByText("問題 1");
    expect(screen.getByText("問題 1").closest("li")?.className).toContain("border-l-correct");
    expect(screen.getByText("問題 2").closest("li")?.className).toContain("border-l-incorrect");
  });
});
