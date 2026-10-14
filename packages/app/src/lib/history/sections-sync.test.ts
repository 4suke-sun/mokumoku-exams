import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type KeyValueStore,
  loadSectionProgress,
  ownedStore,
  type SectionProgress,
  saveSectionProgress,
} from "@/lib/storage.ts";
import { syncSectionProgress } from "./client.ts";

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const record = (correct: number, finishedAt = "2026-10-01T00:00:00.000Z") => ({ correct, total: 5, finishedAt });
const progress = (best: SectionProgress["best"]): SectionProgress => ({ examCode: "EX-SMP-XX", best });

/** fetch の代わり。GET はサーバーの進捗を返し、PUT は受け取った進捗とサーバーの進捗を 1 つにして返す */
function fakeServer(initial: SectionProgress | null, options: { failPut?: boolean } = {}) {
  let server = initial;
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push(method);
      if (!server) return new Response("{}", { status: 401 });
      if (method === "PUT") {
        if (options.failPut) return new Response("{}", { status: 503 });
        const incoming = JSON.parse(String(init?.body)) as SectionProgress;
        const best = { ...server.best };
        for (const [key, value] of Object.entries(incoming.best)) {
          if (!best[key] || value.correct > best[key].correct) best[key] = value;
        }
        server = { examCode: server.examCode, best };
      }
      return Response.json({ progress: server });
    }),
  );
  return { calls, current: () => server };
}

afterEach(() => vi.unstubAllGlobals());

describe("セクションの進捗の同期", () => {
  it("別の端末の進捗がサーバーにある_端末にも取り込み_同じ進捗が見える", async () => {
    const server = fakeServer(progress({ "0": record(5), "1": record(4) }));
    const store = memoryStore();
    const synced = await syncSectionProgress(store, "EX-SMP-XX");
    expect(Object.keys(synced.best)).toEqual(["0", "1"]);
    expect(loadSectionProgress(store, "EX-SMP-XX").best["1"]?.correct).toBe(4);
    expect(server.calls).toEqual(["GET"]);
  });

  it("端末にだけある進捗_初回にサーバーへ取り込み_サーバーの記録と統合される", async () => {
    const server = fakeServer(progress({ "0": record(3) }));
    const store = memoryStore();
    saveSectionProgress(store, progress({ "0": record(5), "2": record(4) }));
    const synced = await syncSectionProgress(store, "EX-SMP-XX");
    expect(synced.best["0"]?.correct).toBe(5);
    expect(synced.best["2"]?.correct).toBe(4);
    expect(server.current()?.best["2"]?.correct).toBe(4);
    expect(server.calls).toEqual(["GET", "PUT"]);
  });

  it("端末の進捗がサーバーに含まれている_取り込みの送信をしない", async () => {
    const server = fakeServer(progress({ "0": record(5) }));
    const store = memoryStore();
    saveSectionProgress(store, progress({ "0": record(4) }));
    await syncSectionProgress(store, "EX-SMP-XX");
    expect(server.calls).toEqual(["GET"]);
  });

  it("未ログインなどでサーバーを読めない_端末の進捗をそのまま返す", async () => {
    fakeServer(null);
    const store = memoryStore();
    saveSectionProgress(store, progress({ "0": record(4) }));
    expect((await syncSectionProgress(store, "EX-SMP-XX")).best["0"]?.correct).toBe(4);
  });

  it("取り込みの送信に失敗した_端末の進捗を含めた統合結果を返し_端末の記録は残る", async () => {
    fakeServer(progress({ "1": record(2) }), { failPut: true });
    const store = memoryStore();
    saveSectionProgress(store, progress({ "0": record(4) }));
    const synced = await syncSectionProgress(store, "EX-SMP-XX");
    expect(Object.keys(synced.best).sort()).toEqual(["0", "1"]);
    expect(Object.keys(loadSectionProgress(store, "EX-SMP-XX").best).sort()).toEqual(["0", "1"]);
  });

  it("端末に別のアカウントの進捗がある_読まず_サーバーへ取り込まず_その記録も残す", async () => {
    const server = fakeServer(progress({ "1": record(2) }));
    const device = memoryStore();
    saveSectionProgress(ownedStore(device, "aaaaaaaaaaaaaaaa"), progress({ "0": record(5), "1": record(5) }));
    const store = ownedStore(device, "bbbbbbbbbbbbbbbb");
    const synced = await syncSectionProgress(store, "EX-SMP-XX");
    expect(synced.best).toEqual({ "1": record(2) });
    expect(server.calls).toEqual(["GET"]);
    expect(server.current()?.best).toEqual({ "1": record(2) });
    expect(loadSectionProgress(ownedStore(device, "aaaaaaaaaaaaaaaa"), "EX-SMP-XX").best["0"]?.correct).toBe(5);
  });

  it("持ち主の印が取れない_端末の進捗を読まず_サーバーへ取り込まない", async () => {
    const server = fakeServer(progress({ "1": record(2) }));
    const device = memoryStore();
    saveSectionProgress(ownedStore(device, "aaaaaaaaaaaaaaaa"), progress({ "0": record(5) }));
    const synced = await syncSectionProgress(ownedStore(device, null), "EX-SMP-XX");
    expect(synced.best).toEqual({ "1": record(2) });
    expect(server.calls).toEqual(["GET"]);
  });
});
