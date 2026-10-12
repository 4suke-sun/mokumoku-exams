// @vitest-environment jsdom
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, loadSession, saveSectionCheck, saveSession } from "@/lib/storage.ts";
import type { PublishedExam } from "@/lib/types.ts";
import { SectionPicker } from "./section-picker.tsx";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const exam = { examCode: "TEST", name: "テスト資格", shortName: "TEST" } as PublishedExam;
// 7 問: 5 問と 2 問のセクションになる
const items = [1, 2, 3, 4, 5, 6, 7].map((n) => ({ questionId: `TEST-000${n}`, choiceKeys: ["A", "B"] }));
const at = "2026-10-12T00:00:00.000Z";

beforeEach(() => {
  localStorage.clear();
  push.mockClear();
});

describe("SectionPicker", () => {
  it("5 問ずつに分け_最後は少ない問題数のまま_状態と合格の数を出す", async () => {
    saveSectionCheck(browserStore(), "TEST", 0, { correct: 5, total: 5, finishedAt: at });
    saveSectionCheck(browserStore(), "TEST", 1, { correct: 1, total: 2, finishedAt: at });
    render(<SectionPicker exam={exam} items={items} />);
    expect(await screen.findByText("1 / 2 セクション合格")).toBeTruthy();
    const cards = screen.getAllByRole("listitem");
    expect(cards).toHaveLength(2);
    expect(within(cards[0] as HTMLElement).getByText("満点")).toBeTruthy();
    expect(within(cards[1] as HTMLElement).getByText("未達")).toBeTruthy();
    expect(within(cards[1] as HTMLElement).getByText(/問題 6〜7\(2 問、2 問の正解で合格\)/)).toBeTruthy();
  });

  it("いちばん良い記録を残す_あとで点が下がっても合格のまま", async () => {
    saveSectionCheck(browserStore(), "TEST", 0, { correct: 4, total: 5, finishedAt: at });
    saveSectionCheck(browserStore(), "TEST", 0, { correct: 2, total: 5, finishedAt: at });
    render(<SectionPicker exam={exam} items={items} />);
    expect(await screen.findByText("1 / 2 セクション合格")).toBeTruthy();
    expect(within(screen.getAllByRole("listitem")[0] as HTMLElement).getByText("合格")).toBeTruthy();
  });

  it("セクションを解く_そのセクションの問題で出題を始める", async () => {
    render(<SectionPicker exam={exam} items={items} />);
    const user = userEvent.setup();
    await user.click(await screen.findByRole("button", { name: "セクション 2 を解く" }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/exams/TEST/play"));
    const session = loadSession(browserStore(), "TEST");
    expect(session?.section).toBe(1);
    expect(session?.questionIds).toEqual(["TEST-0006", "TEST-0007"]);
  });

  it("途中のセクションの出題がある_続きから解ける", async () => {
    saveSession(browserStore(), {
      examCode: "TEST",
      questionIds: ["TEST-0001"],
      answers: {},
      index: 0,
      startedAt: at,
      section: 0,
    });
    render(<SectionPicker exam={exam} items={items} />);
    expect(await screen.findByText("セクション 1 の途中の出題があります。")).toBeTruthy();
    expect(screen.getByRole("link", { name: "続きから解く" }).getAttribute("href")).toBe("/exams/TEST/play");
  });
});
