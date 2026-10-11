// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, loadSession, saveSession, saveSettings, saveStageCheck } from "@/lib/storage.ts";
import { ModeSelect } from "./mode-select.tsx";
import { StudyStart } from "./study-start.tsx";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const items = [
  { questionId: "TEST-0003", choiceKeys: ["A", "B"] },
  { questionId: "TEST-0001", choiceKeys: ["A", "B"] },
];

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

describe("StudyStart", () => {
  it("この単元の問題を解く_関連の問題だけを_その順で出題し始める", async () => {
    render(<StudyStart examCode="TEST" items={items} />);
    await userEvent.setup().click(screen.getByRole("button", { name: "この単元の問題を解く(2 問)" }));

    const session = loadSession(browserStore(), "TEST");
    expect(session?.questionIds).toEqual(["TEST-0003", "TEST-0001"]);
    expect(session?.index).toBe(0);
    expect(session?.choiceOrder).toBeUndefined();
    expect(push).toHaveBeenCalledWith("/exams/TEST/play");
  });

  it("選択肢のシャッフルの設定_学習モードの出題にも従う", async () => {
    saveSettings(browserStore(), { shuffleChoices: true });
    render(<StudyStart examCode="TEST" items={items} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /この単元の問題を解く/ }));
    expect(Object.keys(loadSession(browserStore(), "TEST")?.choiceOrder ?? {}).sort()).toEqual([
      "TEST-0001",
      "TEST-0003",
    ]);
  });

  it("出題の途中の状態がある_新しく始めると消えることを伝える", async () => {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: ["TEST-0002"],
      answers: {},
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
    });
    render(<StudyStart examCode="TEST" items={items} />);
    expect(await screen.findByText(/新しく始めると、その続きは消えます/)).toBeTruthy();
  });

  it("問題がない_始められない", () => {
    render(<StudyStart examCode="TEST" items={[]} />);
    expect(screen.getByRole("button", { name: /この単元の問題を解く/ }).hasAttribute("disabled")).toBe(true);
  });
});

describe("StudyStart の段階", () => {
  const stages = {
    unitId: "basics",
    list: [
      { order: 1, items: [items[0] as (typeof items)[number]] },
      { order: 3, items: [items[1] as (typeof items)[number]] },
      { order: 7, items },
    ],
  };
  const stageButton = (n: number) => screen.getByRole("button", { name: new RegExp(`^段階 ${n} の確認問題を解く`) });

  it("合格した段階がない_最初の段階だけ挑戦できる", () => {
    render(<StudyStart examCode="TEST" items={items} stages={stages} />);
    expect(stageButton(1).hasAttribute("disabled")).toBe(false);
    expect(stageButton(2).hasAttribute("disabled")).toBe(true);
    expect(stageButton(3).hasAttribute("disabled")).toBe(true);
    expect(screen.getAllByText("前の段階に合格すると挑戦できます")).toHaveLength(2);
    expect(screen.getByText(/正答率が 80% 以上なら、次の段階へ進めます/)).toBeTruthy();
  });

  it("前の段階に合格している_次の段階へ進める", async () => {
    saveStageCheck(browserStore(), "TEST", {
      unitId: "basics",
      order: 1,
      percent: 100,
      passed: true,
      finishedAt: "2026-10-10T00:00:00.000Z",
    });
    render(<StudyStart examCode="TEST" items={items} stages={stages} />);
    expect(await screen.findByText("合格済み")).toBeTruthy();
    expect(stageButton(2).hasAttribute("disabled")).toBe(false);
    expect(stageButton(3).hasAttribute("disabled")).toBe(true);
  });

  it("段階の確認問題を解く_その段階の問題だけで_段階をつけて出題し始める", async () => {
    render(<StudyStart examCode="TEST" items={items} stages={stages} />);
    await userEvent.setup().click(stageButton(1));
    const session = loadSession(browserStore(), "TEST");
    expect(session?.questionIds).toEqual(["TEST-0003"]);
    expect(session?.stage).toEqual({ unitId: "basics", order: 1 });
    expect(push).toHaveBeenCalledWith("/exams/TEST/play");
  });

  it("この単元の問題を解く_段階をつけない", async () => {
    render(<StudyStart examCode="TEST" items={items} stages={stages} />);
    await userEvent.setup().click(screen.getByRole("button", { name: /この単元の問題を解く/ }));
    expect(loadSession(browserStore(), "TEST")?.stage).toBeUndefined();
  });

  it("段階のない単元_段階の一覧を出さない", () => {
    render(<StudyStart examCode="TEST" items={items} />);
    expect(screen.queryByRole("heading", { name: "段階ごとに確かめる" })).toBeNull();
  });
});

describe("モード選択の学習モード", () => {
  const exam = {
    examCode: "TEST",
    name: "テスト資格",
    shortName: "TEST",
    passingScore: 700,
    totalScore: 1000,
    domains: [{ code: "domain1", name: "分野 1", weight: 1 }],
  } as Parameters<typeof ModeSelect>[0]["exam"];
  const pool = [
    { questionId: "TEST-0001", domain: "domain1", questionType: "single" as const, choiceKeys: ["A", "B"] },
  ];

  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 503, json: async () => ({}) })),
    );
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("カリキュラムがある_単元の一覧へのリンクを出す", () => {
    render(<ModeSelect exam={exam} pool={pool} studyAvailable />);
    expect(screen.getByRole("link", { name: "学習モード" }).getAttribute("href")).toBe("/exams/TEST/study");
  });

  it("カリキュラムがない_準備中のまま_リンクを出さない", () => {
    render(<ModeSelect exam={exam} pool={pool} />);
    expect(screen.queryByRole("link", { name: "学習モード" })).toBeNull();
    expect(screen.getByText(/単元ごとに読んでから解きます。\(準備中です\)/)).toBeTruthy();
  });
});
