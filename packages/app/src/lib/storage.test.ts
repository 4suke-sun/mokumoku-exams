import { describe, expect, it } from "vitest";
import {
  clearSession,
  type KeyValueStore,
  loadResults,
  loadSession,
  MAX_RESULTS,
  type Result,
  type Session,
  saveResult,
  saveSession,
} from "./storage.ts";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const brokenStore: KeyValueStore = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
  removeItem: () => {
    throw new Error("blocked");
  },
};

const session: Session = {
  examCode: "TEST",
  questionIds: ["TEST-0001", "TEST-0002"],
  answers: { "TEST-0001": ["A"] },
  index: 1,
  startedAt: "2026-01-01T00:00:00.000Z",
};

function result(n: number): Result {
  return {
    examCode: "TEST",
    questionIds: ["TEST-0001"],
    answers: { "TEST-0001": ["A"] },
    finishedAt: `2026-01-01T00:00:${String(n).padStart(2, "0")}.000Z`,
  };
}

describe("session", () => {
  it("保存した状態を読み出せる", () => {
    const store = memoryStore();
    expect(saveSession(store, session)).toBe(true);
    expect(loadSession(store, "TEST")).toEqual(session);
  });

  it("保存がなければ null", () => {
    expect(loadSession(memoryStore(), "TEST")).toBeNull();
  });

  it("消すと読み出せなくなる", () => {
    const store = memoryStore();
    saveSession(store, session);
    clearSession(store, "TEST");
    expect(loadSession(store, "TEST")).toBeNull();
  });

  it("壊れた値や、形の違う値は、保存がないものとして扱う", () => {
    expect(loadSession(memoryStore({ "mokumoku:v1:session:TEST": "{not json" }), "TEST")).toBeNull();
    expect(loadSession(memoryStore({ "mokumoku:v1:session:TEST": '{"examCode":"TEST"}' }), "TEST")).toBeNull();
  });

  it("大きすぎる値は、保存がないものとして扱う", () => {
    const tooLong = { ...session, questionIds: Array.from({ length: 1001 }, (_, i) => `TEST-${i}`) };
    const store = memoryStore({ "mokumoku:v1:session:TEST": JSON.stringify(tooLong) });
    expect(loadSession(store, "TEST")).toBeNull();
  });

  it("__proto__ という名前のキーがあっても、Object のプロトタイプを書き換えない", () => {
    const raw = `{"examCode":"TEST","questionIds":["TEST-0001"],"answers":{"__proto__":["A"]},"index":0,"startedAt":"x"}`;
    const loaded = loadSession(memoryStore({ "mokumoku:v1:session:TEST": raw }), "TEST");
    expect(({} as Record<string, unknown>).A).toBeUndefined();
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    // 読めた場合も、回答の入れ物のプロトタイプは書き換わっていない
    if (loaded) expect(Object.getPrototypeOf(loaded.answers)).toBe(Object.prototype);
  });

  it("別の資格の状態が入っていたら、使わない", () => {
    const store = memoryStore({ "mokumoku:v1:session:TEST": JSON.stringify({ ...session, examCode: "OTHER" }) });
    expect(loadSession(store, "TEST")).toBeNull();
  });
});

describe("results", () => {
  it("新しい順に保存する", () => {
    const store = memoryStore();
    saveResult(store, result(1));
    saveResult(store, result(2));
    expect(loadResults(store, "TEST").map((r) => r.finishedAt)).toEqual([
      "2026-01-01T00:00:02.000Z",
      "2026-01-01T00:00:01.000Z",
    ]);
  });

  it(`${MAX_RESULTS} 件を超えた古い結果は捨てる`, () => {
    const store = memoryStore();
    for (let i = 0; i < MAX_RESULTS + 3; i++) saveResult(store, result(i));
    const results = loadResults(store, "TEST");
    expect(results).toHaveLength(MAX_RESULTS);
    expect(results[0]?.finishedAt).toBe(`2026-01-01T00:00:${String(MAX_RESULTS + 2).padStart(2, "0")}.000Z`);
  });

  it("壊れた値は、空の一覧として扱う", () => {
    expect(loadResults(memoryStore({ "mokumoku:v1:results:TEST": "[1,2]" }), "TEST")).toEqual([]);
  });
});

describe("保存先が使えないとき", () => {
  it("読み出しは null か空、保存は false を返し、例外を出さない", () => {
    expect(loadSession(brokenStore, "TEST")).toBeNull();
    expect(loadResults(brokenStore, "TEST")).toEqual([]);
    expect(saveSession(brokenStore, session)).toBe(false);
    expect(saveResult(brokenStore, result(1))).toBe(false);
    expect(() => clearSession(brokenStore, "TEST")).not.toThrow();
  });
});
