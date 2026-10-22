// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, loadResults } from "@/lib/storage.ts";
import type { ChoiceQuestion } from "@/lib/types.ts";
import { UnitPractice } from "./unit-practice.tsx";

const exam = { examCode: "TEST", domains: [{ code: "domain1", name: "分野 1", weight: 1 }] };
const next = {
  nextUnit: { href: "/exams/TEST/study/two", title: "次の単元" },
  nextDomain: null,
  listHref: "/exams/TEST/study",
};

const single = (n: number, correct = "A"): ChoiceQuestion =>
  ({
    questionId: `TEST-000${n}`,
    examCode: "TEST",
    domain: "domain1",
    questionType: "single",
    questionText: `問題文 ${n}`,
    choices: [
      { key: "A", text: `選択肢 ${n}-1` },
      { key: "B", text: `選択肢 ${n}-2` },
    ],
    correctAnswers: [correct],
    explanation: `## 結論\n\n解説 ${n}`,
  }) as ChoiceQuestion;

const multiple = {
  ...single(9),
  questionId: "TEST-0009",
  questionType: "multiple",
  choices: [
    { key: "A", text: "複数 1" },
    { key: "B", text: "複数 2" },
    { key: "C", text: "複数 3" },
  ],
  correctAnswers: ["A", "C"],
} as ChoiceQuestion;

/** 通信の応答。ok なら結果をアカウントに保存できたことにする */
function stubServer(ok: boolean) {
  const fetchMock = vi.fn(async (_url: string, _init?: { method?: string }) => ({
    ok,
    status: ok ? 200 : 503,
    json: async () => ({}),
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  localStorage.clear();
  stubServer(false);
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

async function start(questions: ChoiceQuestion[]) {
  render(<UnitPractice exam={exam} questions={questions} next={next} />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: `この単元の問題を解く(${questions.length} 問)` }));
  return user;
}

describe("UnitPractice", () => {
  it("始める前_問題の数つきのボタンだけを出す", () => {
    render(<UnitPractice exam={exam} questions={[single(1), single(2)]} next={next} />);
    expect(screen.getByRole("button", { name: "この単元の問題を解く(2 問)" })).toBeTruthy();
    expect(screen.queryByText("問題文 1")).toBeNull();
  });

  it("問題がない_ボタンを押せない", () => {
    render(<UnitPractice exam={exam} questions={[]} next={next} />);
    expect(screen.getByRole("button", { name: /この単元の問題を解く/ }).hasAttribute("disabled")).toBe(true);
  });

  it("回答する前_選ぶまで回答するを押せない", async () => {
    await start([single(1)]);
    expect(screen.getByText("問題文 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "回答する" }).hasAttribute("disabled")).toBe(true);
    await userEvent.setup().click(screen.getByLabelText(/選択肢 1-1/));
    expect(screen.getByRole("button", { name: "回答する" }).hasAttribute("disabled")).toBe(false);
  });

  it("正解を回答する_すぐ正誤と解説を出し_弾む動きの印を付け_選択を変えられない", async () => {
    const user = await start([single(1), single(2)]);
    await user.click(screen.getByLabelText(/選択肢 1-1/));
    await user.click(screen.getByRole("button", { name: "回答する" }));
    const verdict = screen.getByText("○ 正解です");
    expect(verdict.className).toContain("motion-correct");
    expect(screen.getByText("解説 1")).toBeTruthy();
    expect(screen.queryByRole("radio")).toBeNull();
    // 回答したあとは、正誤の表示へフォーカスが移る
    await waitFor(() => expect(document.activeElement).toBe(verdict));
  });

  it("出典のある問題を回答する_解説の下に出典の一覧を出す", async () => {
    const withReferences = {
      ...single(1),
      references: [{ title: "公式の資料", url: "https://docs.aws.amazon.com/guide" }],
    } as ChoiceQuestion;
    const user = await start([withReferences]);
    await user.click(screen.getByLabelText(/選択肢 1-1/));
    await user.click(screen.getByRole("button", { name: "回答する" }));
    expect(screen.getByRole("heading", { name: "出典" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "公式の資料(外部サイト)" }).getAttribute("href")).toBe(
      "https://docs.aws.amazon.com/guide",
    );
  });

  it("出典のない問題を回答する_出典の見出しを出さない", async () => {
    const user = await start([single(1)]);
    await user.click(screen.getByLabelText(/選択肢 1-1/));
    await user.click(screen.getByRole("button", { name: "回答する" }));
    expect(screen.getByText("解説 1")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "出典" })).toBeNull();
    expect(screen.queryByRole("link")).toBeNull();
  });

  it("不正解を回答する_正解を示し_揺れる動きの印を付ける", async () => {
    const user = await start([single(1)]);
    await user.click(screen.getByLabelText(/選択肢 1-2/));
    await user.click(screen.getByRole("button", { name: "回答する" }));
    const verdict = screen.getByText("× 不正解です。正解は A です");
    expect(verdict.className).toContain("motion-wrong");
  });

  it("連続して正解する_n 連続正解を出し_間違えると消える", async () => {
    const user = await start([single(1), single(2), single(3)]);
    for (const n of [1, 2]) {
      await user.click(screen.getByLabelText(new RegExp(`選択肢 ${n}-1`)));
      await user.click(screen.getByRole("button", { name: "回答する" }));
      await user.click(screen.getByRole("button", { name: "次の問題へ" }));
    }
    expect(screen.getByText(/2 連続正解/)).toBeTruthy();
    await user.click(screen.getByLabelText(/選択肢 3-2/));
    await user.click(screen.getByRole("button", { name: "回答する" }));
    expect(screen.queryByText(/連続正解/)).toBeNull();
  });

  it("複数選択の問題_すべての正解を選んで正解になる", async () => {
    const user = await start([multiple]);
    expect(screen.getByText("2 つ選んでください。")).toBeTruthy();
    await user.click(screen.getByLabelText(/複数 1/));
    await user.click(screen.getByLabelText(/複数 3/));
    await user.click(screen.getByRole("button", { name: "回答する" }));
    expect(screen.getByText("○ 正解です")).toBeTruthy();
  });

  it("最後の問題_結果を見るで完了画面へ進み_結果を端末に残す(アカウントに保存できないとき)", async () => {
    const user = await start([single(1), single(2)]);
    await user.click(screen.getByLabelText(/選択肢 1-1/));
    await user.click(screen.getByRole("button", { name: "回答する" }));
    await user.click(screen.getByRole("button", { name: "次の問題へ" }));
    await user.click(screen.getByLabelText(/選択肢 2-2/));
    await user.click(screen.getByRole("button", { name: "回答する" }));
    await user.click(screen.getByRole("button", { name: "結果を見る" }));

    expect(await screen.findByText("単元の問題を解き終えました")).toBeTruthy();
    expect(screen.getByText("2 問中 1 問が正解です。")).toBeTruthy();
    expect(screen.getByText(/この端末に結果を残しました/)).toBeTruthy();
    const saved = loadResults(browserStore(), "TEST");
    expect(saved).toHaveLength(1);
    expect(saved[0]?.questionIds).toEqual(["TEST-0001", "TEST-0002"]);
    expect(saved[0]?.answers).toEqual({ "TEST-0001": ["A"], "TEST-0002": ["B"] });
    expect(saved[0]?.timesMs).toHaveLength(2);
  });

  it("アカウントに保存できる_端末には残さない", async () => {
    const fetchMock = stubServer(true);
    const user = await start([single(1)]);
    await user.click(screen.getByLabelText(/選択肢 1-1/));
    await user.click(screen.getByRole("button", { name: "回答する" }));
    await user.click(screen.getByRole("button", { name: "結果を見る" }));
    expect(await screen.findByText("単元の問題を解き終えました")).toBeTruthy();
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === "POST")).toBe(true);
    expect(loadResults(browserStore(), "TEST")).toHaveLength(0);
    expect(screen.queryByText(/この端末に結果を残しました/)).toBeNull();
  });

  it("完了画面_次の単元・分野の一覧・もう一度・結果の詳細へ進める", async () => {
    const user = await start([single(1)]);
    await user.click(screen.getByLabelText(/選択肢 1-1/));
    await user.click(screen.getByRole("button", { name: "回答する" }));
    await user.click(screen.getByRole("button", { name: "結果を見る" }));
    await screen.findByText("単元の問題を解き終えました");
    expect(screen.getByRole("link", { name: /次の単元へ\(次の単元\)/ }).getAttribute("href")).toBe(
      "/exams/TEST/study/two",
    );
    expect(screen.getByRole("link", { name: "分野の一覧へ" }).getAttribute("href")).toBe("/exams/TEST/study");
    expect(screen.getByRole("link", { name: "結果の詳しい画面を見る" }).getAttribute("href")).toContain(
      "/exams/TEST/result?at=",
    );
    await user.click(screen.getByRole("button", { name: "この単元をもう一度解く" }));
    expect(screen.getByText("問題文 1")).toBeTruthy();
    expect(screen.getByRole("button", { name: "回答する" }).hasAttribute("disabled")).toBe(true);
  });

  it("同じ分野に次の単元がない_次の分野を示す", async () => {
    render(
      <UnitPractice
        exam={exam}
        questions={[single(1)]}
        next={{ nextUnit: null, nextDomain: { href: "/exams/TEST/study/three", name: "次の分野" }, listHref: "/x" }}
      />,
    );
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: /この単元の問題を解く/ }));
    await user.click(screen.getByLabelText(/選択肢 1-1/));
    await user.click(screen.getByRole("button", { name: "回答する" }));
    await user.click(screen.getByRole("button", { name: "結果を見る" }));
    expect(await screen.findByRole("link", { name: /次の分野へ\(次の分野\)/ })).toBeTruthy();
    expect(screen.queryByRole("link", { name: /次の単元へ/ })).toBeNull();
  });
});
