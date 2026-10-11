import { describe, expect, it } from "vitest";
import {
  clearSession,
  DEFAULT_SETTINGS,
  type KeyValueStore,
  loadResults,
  loadSession,
  loadSettings,
  loadStageProgress,
  MAX_ANSWER_TIME_MS,
  MAX_RESULTS,
  passedStages,
  type Result,
  type Session,
  type StageCheck,
  saveResult,
  saveSession,
  saveSettings,
  saveStageCheck,
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

  it("本番モードの締め切り_保存して読み出せる", () => {
    const store = memoryStore();
    const official = { ...session, deadline: "2026-01-01T00:10:00.000Z" };
    saveSession(store, official);
    expect(loadSession(store, "TEST")?.deadline).toBe("2026-01-01T00:10:00.000Z");
  });

  it("解答の表示のしかたと、問題ごとの記録_保存して読み出せる", () => {
    const store = memoryStore();
    const marked: Session = {
      ...session,
      reveal: "each",
      checked: [true, false],
      timesMs: [3000, 0],
      unsure: [false, true],
      flagged: [true, false],
    };
    saveSession(store, marked);
    expect(loadSession(store, "TEST")).toEqual(marked);
  });

  it("問題ごとの記録の数が問題の数と合わない_保存がないものとして扱う", () => {
    const raw = JSON.stringify({ ...session, checked: [true] });
    expect(loadSession(memoryStore({ "mokumoku:v1:session:TEST": raw }), "TEST")).toBeNull();
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

  it("回答時間・自信なし・見直しを持つ結果_そのまま読み直せる_持たない古い結果も読める", () => {
    const store = memoryStore();
    const marked = { ...result(1), timesMs: [4200], unsure: [true], flagged: [false] };
    saveResult(store, result(0));
    saveResult(store, marked);
    expect(loadResults(store, "TEST")).toEqual([marked, result(0)]);
  });

  it.each([
    ["回答時間の数が問題の数と合わない", { timesMs: [1, 2] }],
    ["回答時間が上限を超える", { timesMs: [MAX_ANSWER_TIME_MS + 1] }],
    ["自信なしの数が問題の数と合わない", { unsure: [] }],
    ["見直しが真偽値でない", { flagged: [1] }],
  ])("%s_壊れた値として扱う", (_name, over) => {
    const raw = JSON.stringify([{ ...result(1), ...over }]);
    expect(loadResults(memoryStore({ "mokumoku:v1:results:TEST": raw }), "TEST")).toEqual([]);
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

describe("設定", () => {
  it("保存なし_既定値", () => {
    expect(loadSettings(memoryStore())).toEqual(DEFAULT_SETTINGS);
  });

  it("保存した設定_読み出せる", () => {
    const store = memoryStore();
    expect(saveSettings(store, { shuffleChoices: true })).toBe(true);
    expect(loadSettings(store)).toEqual({ shuffleChoices: true });
  });

  it("壊れた設定_既定値", () => {
    expect(loadSettings(memoryStore({ "mokumoku:v1:settings": '{"shuffleChoices":"yes"}' }))).toEqual(DEFAULT_SETTINGS);
  });

  it("保存が禁止された環境_保存は失敗し読み出しは既定値", () => {
    expect(saveSettings(brokenStore, { shuffleChoices: true })).toBe(false);
    expect(loadSettings(brokenStore)).toEqual(DEFAULT_SETTINGS);
  });
});

describe("選択肢の並びの保存", () => {
  it("並びつきの出題中の状態_保存して読み出せる", () => {
    const store = memoryStore();
    const session = {
      examCode: "TEST",
      questionIds: ["TEST-0001"],
      answers: {},
      index: 0,
      startedAt: "2026-10-10T00:00:00.000Z",
      choiceOrder: { "TEST-0001": ["B", "A"] },
    };
    saveSession(store, session);
    expect(loadSession(store, "TEST")).toEqual(session);
  });
});

describe("段階学習の到達の状態", () => {
  const check = (over: Partial<StageCheck> = {}): StageCheck => ({
    unitId: "basics",
    order: 1,
    percent: 100,
    passed: true,
    finishedAt: "2026-10-10T00:00:00.000Z",
    ...over,
  });

  it("段階の確認つきの出題中の状態_保存して読み出せる", () => {
    const store = memoryStore();
    const staged = { ...session, stage: { unitId: "basics", order: 2 } };
    saveSession(store, staged);
    expect(loadSession(store, "TEST")).toEqual(staged);
  });

  it("保存されていない_どの段階にも合格していない", () => {
    const progress = loadStageProgress(memoryStore(), "TEST");
    expect(progress).toEqual({ examCode: "TEST", passed: {} });
    expect(passedStages(progress, "basics")).toEqual([]);
    expect(passedStages(progress, "constructor")).toEqual([]);
  });

  it("合格_その段階を合格済みにし_直近の確認として残す", () => {
    const store = memoryStore();
    expect(saveStageCheck(store, "TEST", check({ order: 2 }))).toBe(true);
    expect(saveStageCheck(store, "TEST", check({ order: 1 }))).toBe(true);
    const progress = loadStageProgress(store, "TEST");
    expect(passedStages(progress, "basics")).toEqual([1, 2]);
    expect(progress.last).toEqual(check({ order: 1 }));
  });

  it("不合格_合格済みにしない_一度合格した段階は戻さない", () => {
    const store = memoryStore();
    saveStageCheck(store, "TEST", check({ percent: 50, passed: false }));
    expect(passedStages(loadStageProgress(store, "TEST"), "basics")).toEqual([]);
    saveStageCheck(store, "TEST", check());
    saveStageCheck(store, "TEST", check({ percent: 0, passed: false, finishedAt: "2026-10-10T00:01:00.000Z" }));
    const progress = loadStageProgress(store, "TEST");
    expect(passedStages(progress, "basics")).toEqual([1]);
    expect(progress.last?.passed).toBe(false);
  });

  it("壊れた値・別の資格の値_保存されていないものとして扱う", () => {
    const key = "mokumoku:v1:stages:TEST";
    for (const raw of [
      "{",
      '{"examCode":"TEST","passed":{"basics":[0]}}',
      '{"examCode":"TEST","passed":{"Bad_ID":[1]}}',
      '{"examCode":"OTHER","passed":{}}',
    ]) {
      expect(loadStageProgress(memoryStore({ [key]: raw }), "TEST")).toEqual({ examCode: "TEST", passed: {} });
    }
  });

  it("保存が禁止された環境_保存は失敗し読み出しは空", () => {
    expect(saveStageCheck(brokenStore, "TEST", check())).toBe(false);
    expect(loadStageProgress(brokenStore, "TEST")).toEqual({ examCode: "TEST", passed: {} });
  });
});
