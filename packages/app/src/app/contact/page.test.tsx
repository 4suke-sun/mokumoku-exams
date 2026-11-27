// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const published = { examCode: "EX-SMP-XX", name: "見本の資格" };

vi.mock("@/lib/exam-data.ts", () => ({
  findPublishedExam: (code: string) => (code === published.examCode ? published : undefined),
}));
const router = vi.hoisted(() => ({ back: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
/** ログイン状態。既定はログイン中で、ログインなしの場合のテストだけ切り替える */
const session = vi.hoisted(() => ({ status: "signed-in" as "signed-in" | "signed-out" | "loading" }));
vi.mock("@/components/session-provider.tsx", () => ({
  useSession: () => ({ state: { status: session.status }, reload: async () => {}, signOut: async () => {} }),
}));

const { default: ContactPage } = await import("./page.tsx");

/** サーバーの画面を、URL の検索条件を渡して組み立てる */
async function renderPage(query: { exam?: string | string[] } = {}) {
  return render(await ContactPage({ searchParams: Promise.resolve(query) }));
}

beforeEach(() => {
  session.status = "signed-in";
  router.back.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, status: 201, json: async () => ({ status: "sent" }) })),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("お問い合わせの画面", () => {
  it("exam を付けずに開く_試験の表示と対象の選択なしでフォームを出す", async () => {
    await renderPage();
    expect(screen.getByRole("button", { name: "送る" })).toBeTruthy();
    expect(screen.queryByText("資格コード")).toBeNull();
    expect(screen.queryByRole("radio", { name: "全般" })).toBeNull();
  });

  it("公開中の資格の exam を付けて開く_対象の選択をこの試験についてを既定で出し_資格の名前と資格コードを出す", async () => {
    await renderPage({ exam: "EX-SMP-XX" });
    expect((screen.getByRole("radio", { name: "この試験について(見本の資格)" }) as HTMLInputElement).checked).toBe(
      true,
    );
    expect((screen.getByRole("radio", { name: "全般" }) as HTMLInputElement).checked).toBe(false);
    expect(screen.getByText("見本の資格")).toBeTruthy();
    expect(screen.getByText("EX-SMP-XX")).toBeTruthy();
    expect(screen.getByRole("button", { name: "送る" })).toBeTruthy();
  });

  it("開いた直後_元の画面へ戻るボタンを画面の上に 1 つ出し_押すと履歴を 1 つ戻る", async () => {
    for (const query of [{}, { exam: "EX-SMP-XX" }, { exam: "NO-SUCH-XX" }]) {
      await renderPage(query);
      const buttons = screen.getAllByRole("button", { name: "元の画面へ戻る" });
      expect(buttons, JSON.stringify(query)).toHaveLength(1);
      cleanup();
    }
    await renderPage();
    await userEvent.setup().click(screen.getByRole("button", { name: "元の画面へ戻る" }));
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it("送れたあと_元の画面へ戻るボタンを画面の上とお礼の言葉のあとに出す", async () => {
    await renderPage({ exam: "EX-SMP-XX" });
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "その他" }));
    await user.type(screen.getByLabelText("内容"), "x");
    await user.click(screen.getByRole("button", { name: "送る" }));
    await screen.findByText(/お問い合わせを受け付けました/);
    expect(screen.getAllByRole("button", { name: "元の画面へ戻る" })).toHaveLength(2);
  });

  it("公開中の資格に一致しない exam_見つからないと出し_フォームを出さず_試験なしの画面へのリンクを出す", async () => {
    for (const exam of ["NO-SUCH-XX", "", ["EX-SMP-XX", "EX-SMP-XX"]]) {
      await renderPage({ exam });
      expect(screen.getByText("対象の試験が見つかりません。"), JSON.stringify(exam)).toBeTruthy();
      expect(screen.queryByRole("button", { name: "送る" })).toBeNull();
      expect(screen.getByRole("link", { name: "試験を指定せずにお問い合わせ" }).getAttribute("href")).toBe("/contact");
      cleanup();
    }
  });

  it("ログインしていない_フォームの代わりにログインが必要と出し_ログインのあとにこの画面へ戻るリンクを出す", async () => {
    session.status = "signed-out";
    for (const [query, next] of [
      [{}, "/contact"],
      [{ exam: "EX-SMP-XX" }, "/contact?exam=EX-SMP-XX"],
    ] as const) {
      await renderPage(query);
      expect(screen.getByRole("heading", { level: 1, name: "お問い合わせ" })).toBeTruthy();
      expect(screen.getByText("お問い合わせを送るには、ログインが必要です。")).toBeTruthy();
      expect(screen.queryByRole("button", { name: "送る" })).toBeNull();
      expect(screen.queryByLabelText("内容")).toBeNull();
      const login = screen.getByRole("link", { name: "ログインする" }).getAttribute("href") ?? "";
      expect(new URL(login, "https://example.com").searchParams.get("next"), JSON.stringify(query)).toBe(next);
      expect(screen.getByRole("link", { name: "新規登録" }).getAttribute("href")).toBe("/signup");
      expect(screen.getAllByRole("button", { name: "元の画面へ戻る" })).toHaveLength(1);
      cleanup();
    }
  });

  it("ログイン状態を確かめている間_フォームもログインの案内も出さない", async () => {
    session.status = "loading";
    await renderPage();
    expect(screen.queryByRole("button", { name: "送る" })).toBeNull();
    expect(screen.queryByText(/ログインが必要です/)).toBeNull();
  });
});
