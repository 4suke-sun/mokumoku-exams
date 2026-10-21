// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  browserStore,
  loadResults,
  loadSectionProgress,
  loadSession,
  loadStageProgress,
  passedStages,
  saveResult,
  saveSession,
} from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { Player } from "./player.tsx";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
/** 採点のあとは、いま採点した結果を指定して、結果の画面へ移る */
const RESULT_DETAIL = /^\/exams\/TEST\/result\?at=\d{4}-/;

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

    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(RESULT_DETAIL)));
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

    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(RESULT_DETAIL)));
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

    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(RESULT_DETAIL)));
    expect(loadResults(browserStore(), "TEST")).toHaveLength(1);
    // 結果の画面は、いま採点した結果を指定して開く(一覧の先頭に頼らない)
    const [saved] = loadResults(browserStore(), "TEST");
    expect(push).toHaveBeenCalledWith(`/exams/TEST/result?at=${encodeURIComponent(saved?.finishedAt ?? "")}`);
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

  it("選択肢の並びをシャッフルしても_記号は上から_A_B_C_と振り_キーは画面の記号で選ぶ", async () => {
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
    // 元のキーで C, A, B の順に並ぶが、画面の記号は上から A, B, C になる
    const labels = screen.getAllByRole("radio").map((radio) => radio.closest("label")?.textContent?.slice(0, 2));
    expect(labels).toEqual(["A.", "B.", "C."]);
    // A を押すと、画面の 1 番目(元のキーは C)が選ばれる
    const user = userEvent.setup();
    await user.keyboard("a");
    expect(checked()).toEqual([true, false, false]);
  });

  it("画面に_キー操作の案内を表示する", async () => {
    render(<Player exam={exam} questions={questions} />);
    expect(await screen.findByText(/キー操作: A〜C で選ぶ/)).toBeTruthy();
  });
});

describe("Player の段階の確認問題", () => {
  function startStage() {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: questions.map((q) => q.questionId),
      answers: {},
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
      stage: { unitId: "basics", order: 2 },
    });
  }

  async function answer(keys: [string, string]) {
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");
    await user.keyboard(`${keys[0]}{Enter}`);
    await screen.findByText("問題文 2");
    await user.keyboard(`${keys[1]}{Enter}`);
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(RESULT_DETAIL)));
  }

  it("正答率が 80% 以上_その段階を合格済みにする", async () => {
    startStage();
    await answer(["a", "b"]);
    const progress = loadStageProgress(browserStore(), "TEST");
    expect(passedStages(progress, "basics")).toEqual([2]);
    expect(progress.last).toMatchObject({ unitId: "basics", order: 2, percent: 100, passed: true });
    expect(progress.last?.finishedAt).toBe(loadResults(browserStore(), "TEST")[0]?.finishedAt);
  });

  it("正答率が 80% 未満_合格済みにしない", async () => {
    startStage();
    await answer(["a", "a"]);
    const progress = loadStageProgress(browserStore(), "TEST");
    expect(passedStages(progress, "basics")).toEqual([]);
    expect(progress.last).toMatchObject({ percent: 50, passed: false });
  });

  it("段階の確認ではない出題_到達の状態を変えない", async () => {
    await answer(["a", "b"]);
    expect(loadStageProgress(browserStore(), "TEST")).toEqual({ examCode: "TEST", passed: {} });
  });
});

describe("Player の自由記述", () => {
  const freeText = {
    questionId: "TEST-0003",
    examCode: "TEST",
    domain: "domain1",
    questionType: "free-text",
    questionText: "記述の問題文",
    rubric: { criteria: [{ name: "観点", keywords: ["保存"], points: 10 }], passingPoints: 10 },
    explanation: "解説",
  } as Question;
  const mixed = [question(1, "A"), freeText];

  beforeEach(() => {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: mixed.map((q) => q.questionId),
      answers: { "TEST-0001": ["A"] },
      index: 1,
      startedAt: "2026-10-10T00:00:00.000Z",
    });
  });

  it("書く前に採点を押すと_未回答の確認を出し_入力中のキーは操作にならない_書いた内容を結果に残す", async () => {
    render(<Player exam={exam} questions={mixed} />);
    const user = userEvent.setup();
    const input = await screen.findByRole("textbox", { name: "回答" });
    const grade = screen.getByRole("button", { name: "採点する" });

    // 空白だけは未回答なので、採点の前に確認を出し、まだ採点しない
    await user.type(input, "  ");
    await user.click(grade);
    expect((await screen.findByRole("alert")).textContent).toContain("未回答が 1 問あります");
    expect(push).not.toHaveBeenCalled();

    // 入力欄の中の P と Enter は、前へ戻る・採点の操作にならず、文字として入る
    await user.type(input, "Pで保存{Enter}");
    expect(screen.getByText("記述の問題文")).toBeTruthy();
    expect(push).not.toHaveBeenCalled();

    await user.click(grade);
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(RESULT_DETAIL)));
    expect(loadResults(browserStore(), "TEST")[0]?.textAnswers).toEqual({ "TEST-0003": "  Pで保存\n" });
  });

  it("段階の確認問題_自由記述は採点基準の判定で正答率に数える", async () => {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: mixed.map((q) => q.questionId),
      answers: { "TEST-0001": ["A"] },
      index: 1,
      startedAt: "2026-10-10T00:00:00.000Z",
      stage: { unitId: "basics", order: 1 },
    });
    render(<Player exam={exam} questions={mixed} />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "回答" }), "設定を保存する");
    await user.click(screen.getByRole("button", { name: "採点する" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(RESULT_DETAIL)));
    expect(loadStageProgress(browserStore(), "TEST").last).toMatchObject({ percent: 100, passed: true });
  });

  it("1 問ごとの表示で回答する_観点ごとの判定と得点と合格点を出す", async () => {
    const twoCriteria = {
      ...freeText,
      rubric: {
        criteria: [
          { name: "保存の観点", keywords: ["保存"], points: 6 },
          { name: "暗号化の観点", keywords: ["暗号化"], points: 4 },
        ],
        passingPoints: 6,
      },
    } as Question;
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: [twoCriteria.questionId],
      answers: {},
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
      reveal: "each",
    });
    render(<Player exam={exam} questions={[twoCriteria]} />);
    const user = userEvent.setup();
    await user.type(await screen.findByRole("textbox", { name: "回答" }), "設定を保存する");
    await user.click(screen.getByRole("button", { name: "回答する" }));
    expect(await screen.findByText("観点ごとの判定")).toBeTruthy();
    const rows = screen.getAllByRole("listitem").map((li) => li.textContent);
    expect(rows).toContain("○ 満たしている保存の観点6 / 6 点");
    expect(rows).toContain("× 満たしていない暗号化の観点0 / 4 点");
    expect(document.body.textContent).toContain("得点: 6 / 10 点(合格点 6 点)");
  });
});

describe("Player の本番モード", () => {
  const start = Date.parse("2026-10-10T00:00:00.000Z");
  let current = start;
  const clock = () => new Date(current);

  beforeEach(() => {
    current = start;
    // 残り時間を数え直すタイマーを差し替える。画面の待ち合わせ(waitFor)も setInterval を使うので、実時間でも進める
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"], shouldAdvanceTime: true });
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: questions.map((q) => q.questionId),
      answers: {},
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
      deadline: "2026-10-10T00:10:00.000Z",
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** 時計を進め、残り時間を数え直させる */
  function advance(ms: number) {
    current += ms;
    act(() => {
      vi.advanceTimersByTime(1000);
    });
  }

  it("残り時間を表示し_時計が進むと減る", async () => {
    render(<Player exam={exam} questions={questions} clock={clock} />);
    expect(await screen.findByText("10:00")).toBeTruthy();
    advance(61_000);
    expect(screen.getByText("8:59")).toBeTruthy();
  });

  it("再読み込みしても_締め切りから残り時間を数える", async () => {
    current = start + 4 * 60_000;
    render(<Player exam={exam} questions={questions} clock={clock} />);
    expect(await screen.findByText("6:00")).toBeTruthy();
  });

  it("時間切れ_ここまでの回答で自動的に採点し_通常と同じ結果を残す", async () => {
    render(<Player exam={exam} questions={questions} clock={clock} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");
    await user.keyboard("a");
    advance(10 * 60_000);

    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(RESULT_DETAIL)));
    const [saved] = loadResults(browserStore(), "TEST");
    expect(saved?.answers).toEqual({ "TEST-0001": ["A"] });
    expect(saved?.questionIds).toEqual(questions.map((q) => q.questionId));
    expect(saved).not.toHaveProperty("deadline");
  });

  it("締め切りを過ぎてから開いた_すぐに採点する", async () => {
    current = start + 11 * 60_000;
    render(<Player exam={exam} questions={questions} clock={clock} />);
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(RESULT_DETAIL)));
    expect(push).toHaveBeenCalledTimes(1);
    expect(loadResults(browserStore(), "TEST")).toHaveLength(1);
  });

  it("残り 5 分以下_残りわずかと示す", async () => {
    current = start + 4 * 60_000;
    render(<Player exam={exam} questions={questions} clock={clock} />);
    expect(await screen.findByText("6:00")).toBeTruthy();
    expect(screen.queryByText(/残りわずか/)).toBeNull();
    advance(60_000);
    expect(screen.getByText(/残りわずか/)).toBeTruthy();
  });

  it("通常の出題_残り時間を表示しない", async () => {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: questions.map((q) => q.questionId),
      answers: {},
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
    });
    render(<Player exam={exam} questions={questions} clock={clock} />);
    await screen.findByText("問題文 1");
    expect(screen.queryByText(/本番モード/)).toBeNull();
  });
});

describe("Player の 1 問ごとの解答の表示", () => {
  beforeEach(() => {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: questions.map((q) => q.questionId),
      answers: {},
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
      reveal: "each",
    });
  });

  it("Enter で回答し_正誤のバナーへフォーカスを移し_選択を変えられず_Enter で次へ", async () => {
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");

    // 回答する前の Enter は、選んでいなければ何もしない
    await user.keyboard("{Enter}");
    expect(screen.queryByText(/正解です|不正解です/)).toBeNull();

    await user.keyboard("2{Enter}");
    const verdict = await screen.findByText(/× 不正解です。正解は A です/);
    expect(document.activeElement).toBe(verdict.closest("[tabindex]"));
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
    expect(screen.getByText("あなたの回答")).toBeTruthy();

    // 回答したあとの選択のキーは無効
    await user.keyboard("a");
    expect(loadSession(browserStore(), "TEST")?.answers).toEqual({ "TEST-0001": ["B"] });
    expect(loadSession(browserStore(), "TEST")?.checked).toEqual([true, false]);

    await user.keyboard("{Enter}");
    expect(await screen.findByText("問題文 2")).toBeTruthy();
  });

  it("再開したとき_回答済みの問題は_回答後の表示で出す", async () => {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: questions.map((q) => q.questionId),
      answers: { "TEST-0001": ["A"] },
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
      reveal: "each",
      checked: [true, false],
    });
    render(<Player exam={exam} questions={questions} />);
    expect(await screen.findByText("○ 正解です")).toBeTruthy();
    expect(screen.queryAllByRole("radio")).toHaveLength(0);
  });

  it("出典のある問題を回答する_解説を見るを開くと_出典の一覧が出る", async () => {
    const withReferences = [
      {
        ...question(1, "A"),
        references: [{ title: "公式の資料", url: "https://docs.aws.amazon.com/guide" }],
      } as Question,
      question(2, "B"),
    ];
    render(<Player exam={exam} questions={withReferences} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");
    await user.keyboard("1{Enter}");
    await screen.findByText("○ 正解です");
    await user.click(screen.getByText("解説を見る"));
    expect(screen.getByRole("heading", { name: "出典" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "公式の資料(外部サイト)" }).getAttribute("href")).toBe(
      "https://docs.aws.amazon.com/guide",
    );
  });

  it("出典のない問題を回答する_解説を見るを開いても_出典の見出しを出さない", async () => {
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");
    await user.keyboard("1{Enter}");
    await screen.findByText("○ 正解です");
    await user.click(screen.getByText("解説を見る"));
    expect(screen.queryByRole("heading", { name: "出典" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });
});

describe("Player の印と問題一覧", () => {
  it("N で回答せずに飛ばし_問題一覧から移れ_未回答のまま採点すると確認を出す", async () => {
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");

    await user.keyboard("n");
    expect(await screen.findByText("問題文 2")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "問題 1(未回答)" }));
    expect(await screen.findByText("問題文 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "問題 1(未回答)" }).getAttribute("aria-current")).toBe("step");

    await user.keyboard("a");
    expect(screen.getByRole("button", { name: "問題 1(回答済み)" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "問題 2(未回答)" }));
    await user.click(await screen.findByRole("button", { name: "採点する" }));
    expect((await screen.findByRole("alert")).textContent).toContain("未回答が 1 問あります");
    expect(push).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "このまま採点する" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(RESULT_DETAIL)));
  });

  it("自信なしと見直しの印_途中保存と結果に残す_回答時間も結果に残す", async () => {
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");

    await user.click(screen.getByRole("button", { name: "自信なし" }));
    await user.click(screen.getByRole("button", { name: "見直し" }));
    expect(screen.getByRole("button", { name: "自信なし" }).getAttribute("aria-pressed")).toBe("true");
    const saved = loadSession(browserStore(), "TEST");
    expect(saved?.unsure).toEqual([true, false]);
    expect(saved?.flagged).toEqual([true, false]);
    expect(screen.getByRole("button", { name: "問題 1(未回答、見直し)" })).toBeTruthy();

    // ボタンの上の Enter はボタンの操作になるので、フォーカスを外してから、キーで答える
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    await user.keyboard("a{Enter}");
    await screen.findByText("問題文 2");
    await user.keyboard("b{Enter}");
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(RESULT_DETAIL)));
    const [result] = loadResults(browserStore(), "TEST");
    expect(result?.unsure).toEqual([true, false]);
    expect(result?.flagged).toEqual([true, false]);
    expect(result?.timesMs).toHaveLength(2);
  });

  it("中断する_モード選択へ戻り_途中の状態は残る", async () => {
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");
    await user.keyboard("a");
    await user.click(screen.getByRole("button", { name: /中断する/ }));
    expect(push).toHaveBeenCalledWith("/exams/TEST");
    expect(loadSession(browserStore(), "TEST")?.answers).toEqual({ "TEST-0001": ["A"] });
  });
});

describe("Player のセクションと直近の正誤", () => {
  it("セクションの出題を採点する_そのセクションの記録を残す", async () => {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: questions.map((q) => q.questionId),
      answers: {},
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
      section: 3,
    });
    render(<Player exam={exam} questions={questions} />);
    const user = userEvent.setup();
    await screen.findByText("問題文 1");
    await user.keyboard("a{Enter}");
    await screen.findByText("問題文 2");
    await user.keyboard("a{Enter}");
    await waitFor(() => expect(push).toHaveBeenCalledWith(expect.stringMatching(RESULT_DETAIL)));
    expect(loadSectionProgress(browserStore(), "TEST").best["3"]).toMatchObject({ correct: 1, total: 2 });
  });

  it("その問題の直近 5 回の正誤を_古い順に出し_足りない分は - で埋める(端末の結果から)", async () => {
    saveResult(browserStore(), {
      examCode: "TEST",
      questionIds: ["TEST-0001"],
      answers: { "TEST-0001": ["B"] },
      finishedAt: "2026-10-01T00:00:00.000Z",
    });
    saveResult(browserStore(), {
      examCode: "TEST",
      questionIds: ["TEST-0001"],
      answers: { "TEST-0001": ["A"] },
      finishedAt: "2026-10-02T00:00:00.000Z",
    });
    render(<Player exam={exam} questions={questions} />);
    const marks = await screen.findByRole("img", { name: /直近5回の正誤/ });
    expect(marks.getAttribute("aria-label")).toContain("未受験、未受験、未受験、不正解、正解");
    expect(marks.textContent).toBe("---✕○");
  });
});
