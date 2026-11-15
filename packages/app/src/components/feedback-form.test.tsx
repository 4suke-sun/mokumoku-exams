// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FeedbackForm } from "./feedback-form.tsx";

const session = vi.hoisted(() => ({ reload: vi.fn(async () => {}) }));
vi.mock("./session-provider.tsx", () => ({
  useSession: () => ({ state: { status: "signed-in" }, reload: session.reload, signOut: async () => {} }),
}));

type Init = { method?: string; body?: string };
let fetchMock: ReturnType<typeof vi.fn<(url: string, init?: Init) => Promise<unknown>>>;

const reply = (status: number, body: unknown = {}) => ({ ok: status < 300, status, json: async () => body });

beforeEach(() => {
  session.reload.mockClear();
  fetchMock = vi.fn(async () => reply(201, { status: "sent" }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("FeedbackForm", () => {
  it("お問い合わせの画面_返信しないことと公開されうることの注意を出す", () => {
    render(<FeedbackForm form="contact" />);
    expect(screen.getByText("返信はしません。")).toBeTruthy();
    expect(screen.getByText(/公開されることがあります/)).toBeTruthy();
  });

  it("種類と内容を入れて送る_API に送り_お礼の言葉を出して入力を空にする", async () => {
    render(<FeedbackForm form="contact" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "不具合" }));
    await user.type(screen.getByLabelText("内容"), "動かない");
    await user.click(screen.getByRole("button", { name: "送る" }));

    expect(
      await screen.findByText(
        "お問い合わせを受け付けました。ありがとうございます。いただいた内容は、今後の改善の参考にさせていただきます。",
      ),
    ).toBeTruthy();
    // 返信しないことは、送る前の注意にだけ出し、お礼の言葉には入れない
    expect(screen.getAllByText(/返信はしません/)).toHaveLength(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("/api/feedback");
    expect(JSON.parse(init?.body ?? "{}")).toEqual({ form: "contact", category: "bug", text: "動かない" });
    expect((screen.getByLabelText("内容") as HTMLTextAreaElement).value).toBe("");
  });

  it("種類を選ばずに送る_送らずに選ぶよう促す", async () => {
    render(<FeedbackForm form="contact" />);
    const user = userEvent.setup();
    await user.type(screen.getByLabelText("内容"), "x");
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect(await screen.findByText("種類を選んでください。")).toBeTruthy();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("上限を超えた_明日また試すよう伝え_入力を残す", async () => {
    fetchMock.mockResolvedValue(reply(429, { error: "limit-exceeded" }));
    render(<FeedbackForm form="contact" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "その他" }));
    await user.type(screen.getByLabelText("内容"), "残す");
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect(await screen.findByText("今日はこれ以上送れません。明日またお試しください。")).toBeTruthy();
    expect((screen.getByLabelText("内容") as HTMLTextAreaElement).value).toBe("残す");
  });

  it("受け付けを止めている_時間をおいて試すよう伝える", async () => {
    fetchMock.mockResolvedValue(reply(503, { error: "unavailable" }));
    render(<FeedbackForm form="contact" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "その他" }));
    await user.type(screen.getByLabelText("内容"), "x");
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect(await screen.findByText("いまは送れません。時間をおいてお試しください。")).toBeTruthy();
  });

  it("問題の誤りの報告で補足が空_資格コードと問題 ID を添えて送れる", async () => {
    render(<FeedbackForm form="question" examCode="EX-SMP-XX" questionId="SAMPLE-0001" />);
    const user = userEvent.setup();
    await user.click(screen.getByRole("radio", { name: "解説が違う" }));
    await user.click(screen.getByRole("button", { name: "送る" }));
    expect(
      await screen.findByText("ご報告ありがとうございます。いただいた内容をもとに、問題を確認します。"),
    ).toBeTruthy();
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1]?.body ?? "{}")).toEqual({
      form: "question",
      category: "explanation",
      text: "",
      examCode: "EX-SMP-XX",
      questionId: "SAMPLE-0001",
    });
  });
});
