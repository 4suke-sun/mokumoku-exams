// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MoreResults } from "./more-results.tsx";

const older = {
  examCode: "A",
  questionIds: ["A-0001"],
  answers: { "A-0001": ["A"] },
  finishedAt: "2026-10-01T00:00:00.000Z",
};

function respond(status: number, body: unknown) {
  const fetch = vi.fn(async () => ({ ok: status === 200, status, json: async () => body }));
  vi.stubGlobal("fetch", fetch);
  return fetch;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("MoreResults", () => {
  it("続きがない_ボタンを出さない", () => {
    render(<MoreResults examCode="A" next={null} onMore={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("押す_続きの位置から次のページを取り_一覧に足す", async () => {
    const fetch = respond(200, { results: [older], next: older.finishedAt });
    const onMore = vi.fn();
    render(<MoreResults examCode="A" next="2026-10-02T00:00:00.000Z" onMore={onMore} />);
    await userEvent.click(screen.getByRole("button", { name: "もっと見る" }));
    expect(fetch).toHaveBeenCalledWith(
      `/api/history/results?examCode=A&before=${encodeURIComponent("2026-10-02T00:00:00.000Z")}`,
      expect.anything(),
    );
    expect(onMore).toHaveBeenCalledWith({ results: [older], next: older.finishedAt });
  });

  it("続きの取得が空_続きのないページとして渡す", async () => {
    respond(200, { results: [], next: null });
    const onMore = vi.fn();
    render(<MoreResults examCode="A" next="2026-10-02T00:00:00.000Z" onMore={onMore} />);
    await userEvent.click(screen.getByRole("button", { name: "もっと見る" }));
    expect(onMore).toHaveBeenCalledWith({ results: [], next: null });
  });

  it("取得に失敗する_一覧はそのままにして_失敗を伝える", async () => {
    respond(503, { error: "unavailable" });
    const onMore = vi.fn();
    render(<MoreResults examCode="A" next="2026-10-02T00:00:00.000Z" onMore={onMore} />);
    await userEvent.click(screen.getByRole("button", { name: "もっと見る" }));
    expect((await screen.findByRole("alert")).textContent).toContain("続きを読み込めませんでした");
    expect(onMore).not.toHaveBeenCalled();
  });
});
