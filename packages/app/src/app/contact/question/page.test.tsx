// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const published = { examCode: "EX-SMP-XX", name: "見本の資格" };
const question = { questionId: "SAMPLE-0001", questionText: "見本の問題文" };

vi.mock("@/lib/exam-data.ts", () => ({
  findPublishedExam: (code: string) => (code === published.examCode ? published : undefined),
  loadQuestions: async () => [question],
}));
const router = vi.hoisted(() => ({ back: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("@/components/session-provider.tsx", () => ({
  useSession: () => ({ state: { status: "signed-in" }, reload: async () => {}, signOut: async () => {} }),
}));

const { default: ReportQuestionPage } = await import("./page.tsx");

/** サーバーの画面を、URL の検索条件を渡して組み立てる */
async function renderPage(query: { exam?: string; id?: string }) {
  return render(await ReportQuestionPage({ searchParams: Promise.resolve(query) }));
}

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ status: "sent" }) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("問題の誤りの報告の画面", () => {
  it("開いた直後_元の画面へ戻るボタンを画面の上に 1 つ出す", async () => {
    for (const query of [
      { exam: "EX-SMP-XX", id: "SAMPLE-0001" },
      { exam: "EX-SMP-XX", id: "NO-SUCH" },
    ]) {
      await renderPage(query);
      expect(screen.getAllByRole("button", { name: "元の画面へ戻る" }), JSON.stringify(query)).toHaveLength(1);
      cleanup();
    }
  });

  it("送れたあと_元の画面へ戻るボタンを画面の上とお礼の言葉のあとに出す", async () => {
    await renderPage({ exam: "EX-SMP-XX", id: "SAMPLE-0001" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "正解が違う" }));
    await user.click(screen.getByRole("button", { name: "送る" }));
    await screen.findByText(/ご報告ありがとうございます/);
    expect(screen.getAllByRole("button", { name: "元の画面へ戻る" })).toHaveLength(2);
  });
});
