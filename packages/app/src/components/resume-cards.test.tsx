// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { browserStore, type Session, saveSession } from "@/lib/storage.ts";
import { ResumeCards } from "./resume-cards.tsx";

const exams = [
  { examCode: "TEST", name: "テスト資格", questionIds: ["TEST-0001", "TEST-0002", "TEST-0003"] },
  { examCode: "TEST2", name: "テスト資格 2", questionIds: ["TEST2-0001", "TEST2-0002"] },
];

function session(examCode: string, questionIds: string[], answers: Session["answers"], startedAt: string): Session {
  return { examCode, questionIds, answers, index: 0, startedAt };
}

beforeEach(() => {
  localStorage.clear();
});

describe("前回の続きのカード", () => {
  it("途中の状態がある_資格名と進み具合と_続きから解くリンクを出す", async () => {
    saveSession(
      browserStore(),
      session("TEST", ["TEST-0001", "TEST-0002", "TEST-0003"], { "TEST-0001": ["A"] }, "2026-10-11T00:00:00.000Z"),
    );
    render(<ResumeCards exams={exams} />);
    const link = await screen.findByRole("link", { name: "テスト資格を続きから解く" });
    expect(link.getAttribute("href")).toBe("/exams/TEST/play");
    expect(screen.getByText("3 問中 1 問に回答しています。")).toBeTruthy();
    expect(screen.queryByText("テスト資格 2")).toBeNull();
  });

  it("複数の資格に途中の状態がある_新しく始めた順に並べる", async () => {
    saveSession(browserStore(), session("TEST", ["TEST-0001"], {}, "2026-10-10T00:00:00.000Z"));
    saveSession(browserStore(), session("TEST2", ["TEST2-0001"], {}, "2026-10-11T00:00:00.000Z"));
    render(<ResumeCards exams={exams} />);
    await screen.findAllByRole("link");
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/exams/TEST2/play",
      "/exams/TEST/play",
    ]);
  });

  it("途中の状態がない_何も出さない", () => {
    const { container } = render(<ResumeCards exams={exams} />);
    expect(container.textContent).toBe("");
  });

  it("いまのデータにない問題を含む_続きから解けないので出さない", () => {
    saveSession(browserStore(), session("TEST", ["TEST-0001", "TEST-0099"], {}, "2026-10-11T00:00:00.000Z"));
    const { container } = render(<ResumeCards exams={exams} />);
    expect(container.textContent).toBe("");
  });
});
