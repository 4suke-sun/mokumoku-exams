// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browserStore, saveResult } from "@/lib/storage.ts";
import { loadExamResults } from "./load.ts";

const at = (day: number) => ({
  examCode: "EX-SMP-XX",
  questionIds: ["SAMPLE-0001"],
  answers: { "SAMPLE-0001": ["A"] },
  finishedAt: `2026-10-0${day}T00:00:00.000Z`,
});

function stubServer(reply: { status: number; body?: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: reply.status === 200, status: reply.status, json: async () => reply.body ?? {} })),
  );
}

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("資格の結果の読み込み", () => {
  it("サーバーを読めた_この端末にだけ残る記録を合わせ_新しい順に並べる", async () => {
    saveResult(browserStore(), at(1));
    saveResult(browserStore(), at(3));
    stubServer({ status: 200, body: { results: [at(3), at(2)], next: at(2).finishedAt } });
    const loaded = await loadExamResults("EX-SMP-XX");
    expect(loaded.source).toBe("server");
    expect(loaded.next).toBe(at(2).finishedAt);
    expect(loaded.results.map((r) => r.finishedAt)).toEqual([3, 2, 1].map((d) => at(d).finishedAt));
  });

  it("サーバーを読めない_この端末の記録だけにし_続きはない", async () => {
    saveResult(browserStore(), at(1));
    stubServer({ status: 503 });
    expect(await loadExamResults("EX-SMP-XX")).toEqual({ results: [at(1)], source: "local", next: null });
  });
});
