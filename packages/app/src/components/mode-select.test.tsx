// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, loadSession } from "@/lib/storage.ts";
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
