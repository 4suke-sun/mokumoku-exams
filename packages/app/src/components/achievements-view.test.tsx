// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ExamEntry } from "@/lib/history/summaries.ts";
import { browserStore, saveResult } from "@/lib/storage.ts";
import type { PublishedExam } from "@/lib/types.ts";
import { AchievementsView } from "./achievements-view.tsx";
import { HomePredictions } from "./home-predictions.tsx";

const exam = (code: string, name: string) =>
  ({
    examCode: code,
    name,
    shortName: name,
    passingScore: 70,
    totalScore: 100,
    domains: [{ code: "domain1", name: "分野 1", weight: 1 }],
  }) as PublishedExam;

const questions = [1, 2].map((n) => ({
  questionId: `A-000${n}`,
  questionType: "single" as const,
  correctAnswers: ["A"],
  domain: "domain1",
}));
const entries: ExamEntry[] = [{ exam: exam("A", "資格 A"), questions }];

const result = (finishedAt: string, answers: Record<string, string[]>) => ({
  examCode: "A",
  questionIds: questions.map((q) => q.questionId),
  answers,
  finishedAt,
});

type Server = { results?: unknown[] | null; days?: { date: string; answered: number; correct: number }[] | null };

function stubServer(server: Server) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      const fail = { ok: false, status: 503, json: async () => ({}) };
      const ok = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
      if (url.startsWith("/api/history/results")) return server.results ? ok({ results: server.results }) : fail;
      if (url.startsWith("/api/history/days")) return server.days ? ok({ days: server.days }) : fail;
      return fail;
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

describe("AchievementsView", () => {
  it("結果がある_受験回数と最高点と直近の点を出し_直近の受験の詳細へリンクする", async () => {
    stubServer({
      results: [
        result("2026-10-11T01:00:00.000Z", { "A-0001": ["A"] }),
        result("2026-10-11T00:00:00.000Z", { "A-0001": ["A"], "A-0002": ["A"] }),
      ],
      days: [{ date: "2026-10-11", answered: 4, correct: 3 }],
    });
    render(<AchievementsView entries={entries} />);
    expect(await screen.findByText("2 回")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByText("50%")).toBeTruthy();
    const link = screen.getByRole("link", { name: /直近の受験/ });
    expect(link.getAttribute("href")).toContain("/exams/A/result?at=");
    expect(screen.getByRole("link", { name: "学習の状況・目標日" }).getAttribute("href")).toBe("/exams/A/dashboard");
    expect(screen.getByRole("link", { name: /の合格予測/ }).getAttribute("href")).toBe("/exams/A/dashboard");
  });

  it("全資格の学習量_連続日数と凡例を出す", async () => {
    stubServer({ results: [], days: [{ date: "2026-10-11", answered: 4, correct: 3 }] });
    render(<AchievementsView entries={entries} />);
    expect(await screen.findByText(/連続 \d+ 日/)).toBeTruthy();
    expect(screen.getByRole("list", { name: "色の凡例" }).textContent).toContain("20 問以上");
  });

  it("結果がまったくない_案内を出す", async () => {
    stubServer({ results: [], days: [] });
    render(<AchievementsView entries={entries} />);
    expect(await screen.findByText("受験した資格がありません")).toBeTruthy();
    expect(screen.queryByText(/ここに/)).toBeNull();
    expect(screen.getByRole("link", { name: "資格を選ぶ" }).getAttribute("href")).toBe("/exams");
  });

  it("日ごとの学習量を読み込めない_カレンダーの代わりに伝え_受験の概要は出す", async () => {
    stubServer({ results: [result("2026-10-11T00:00:00.000Z", { "A-0001": ["A"] })], days: null });
    render(<AchievementsView entries={entries} />);
    expect(await screen.findByText(/アカウントから読み込めないため、いまは表示できません/)).toBeTruthy();
    expect(screen.getByText("1 回")).toBeTruthy();
  });

  it("サーバーに接続できない_この端末の記録で表示し_その旨を伝える", async () => {
    stubServer({ results: null, days: null });
    saveResult(browserStore(), result("2026-10-11T00:00:00.000Z", { "A-0001": ["A"] }));
    render(<AchievementsView entries={entries} />);
    expect(await screen.findByText(/この端末に保存した記録で表示しています/)).toBeTruthy();
    expect(screen.getByText("1 回")).toBeTruthy();
  });
});

describe("HomePredictions", () => {
  it("受験歴のある資格_合格予測のカードを出す", async () => {
    stubServer({ results: [result("2026-10-11T00:00:00.000Z", { "A-0001": ["A"], "A-0002": ["A"] })] });
    render(<HomePredictions entries={entries} />);
    expect(await screen.findByText("資格 Aの合格予測")).toBeTruthy();
    expect(screen.getByText("100%")).toBeTruthy();
    expect(screen.getByRole("link", { name: "実績を見る" }).getAttribute("href")).toBe("/achievements");
  });

  it("受験歴がない_始め方を案内し_カードは出さない", async () => {
    stubServer({ results: [] });
    render(<HomePredictions entries={entries} />);
    expect(await screen.findByText(/まだ受験した結果がありません/)).toBeTruthy();
    expect(screen.queryByText("資格 Aの合格予測")).toBeNull();
  });

  it("読み込み中_何も出さない", async () => {
    stubServer({ results: [] });
    const { container } = render(<HomePredictions entries={entries} />);
    expect(container.textContent).toBe("");
    await waitFor(() => expect(container.textContent).not.toBe(""));
  });
});
