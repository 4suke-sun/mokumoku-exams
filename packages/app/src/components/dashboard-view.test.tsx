// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { DashboardView } from "./dashboard-view.tsx";

const exam = {
  examCode: "A",
  name: "資格 A",
  shortName: "資格 A",
  passingScore: 70,
  totalScore: 100,
  domains: [{ code: "domain1", name: "分野 1", weight: 1 }],
} as PublishedExam;

const questions = [1, 2, 3].map(
  (n) =>
    ({
      questionId: `A-000${n}`,
      examCode: "A",
      domain: "domain1",
      questionType: "single",
      questionText: `問題 ${n}`,
      choices: [
        { key: "A", text: "a" },
        { key: "B", text: "b" },
      ],
      correctAnswers: ["A"],
      explanation: "解説",
    }) as Question,
);

function stubServer(results: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (url.startsWith("/api/history/results")) return ok({ results });
      if (url.startsWith("/api/history/review") || url.startsWith("/api/history/bookmarks"))
        return ok({ questionIds: [] });
      if (url.startsWith("/api/history/days")) return ok({ days: [] });
      if (url.startsWith("/api/history/goal")) return ok({ date: null });
      return { ok: false, status: 503, json: async () => ({}) };
    }),
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("DashboardView の印の集計", () => {
  it("印を付けた結果がある_自信なし_そのうち正解_見直しの問題の数を出す", async () => {
    stubServer([
      {
        examCode: "A",
        questionIds: ["A-0001", "A-0002", "A-0003"],
        answers: { "A-0001": ["A"], "A-0002": ["B"], "A-0003": ["A"] },
        finishedAt: "2026-10-11T00:00:00.000Z",
        unsure: [true, true, false],
        flagged: [false, false, true],
      },
    ]);
    render(<DashboardView exam={exam} questions={questions} />);
    expect(await screen.findByText("自信なしの印: 2 問(うち正解 1 問)")).toBeTruthy();
    expect(screen.getByText("見直しの印: 1 問")).toBeTruthy();
  });
});
