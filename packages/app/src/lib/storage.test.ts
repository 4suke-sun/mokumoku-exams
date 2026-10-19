import { describe, expect, it } from "vitest";
import {
  clearSession,
  DEFAULT_SETTINGS,
  type KeyValueStore,
  loadConditions,
  loadResults,
  loadSectionProgress,
  loadSession,
  loadSettings,
  loadStageProgress,
  MAX_ANSWER_TIME_MS,
  MAX_RESULTS,
  mergeSectionProgress,
  migrateLegacyExamKeys,
  ownedStore,
  passedStages,
  type Result,
  removeUnownedRecords,
  type SectionProgress,
  type Session,
  type StageCheck,
  saveConditions,
  saveResult,
  saveSectionProgress,
  saveSession,
  saveSettings,
  saveStageCheck,
  setStorageOwner,
  storageOwner,
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

  it(`結果が${MAX_RESULTS}件を超える_古い結果は捨てる`, () => {
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

describe("セクションの進捗の統合", () => {
  const record = (correct: number, finishedAt: string) => ({ correct, total: 5, finishedAt });
  const progress = (best: SectionProgress["best"], last?: SectionProgress["last"]): SectionProgress => ({
    examCode: "TEST",
    best,
    ...(last ? { last } : {}),
  });

  it("同じセクション_正答数の多いほうが残る", () => {
    const merged = mergeSectionProgress(
      progress({ "0": record(3, "2026-10-01T00:00:00.000Z") }),
      progress({ "0": record(4, "2026-10-02T00:00:00.000Z") }),
    );
    expect(merged.best["0"]?.correct).toBe(4);
  });

  it("同じ正答数_すでにある記録(base)を残す", () => {
    const merged = mergeSectionProgress(
      progress({ "0": record(4, "2026-10-01T00:00:00.000Z") }),
      progress({ "0": record(4, "2026-10-02T00:00:00.000Z") }),
    );
    expect(merged.best["0"]?.finishedAt).toBe("2026-10-01T00:00:00.000Z");
  });

  it("片方にだけあるセクション_どちらも残る", () => {
    const merged = mergeSectionProgress(
      progress({ "0": record(5, "2026-10-01T00:00:00.000Z") }),
      progress({ "1": record(2, "2026-10-02T00:00:00.000Z") }),
    );
    expect(Object.keys(merged.best).sort()).toEqual(["0", "1"]);
  });

  it("直近の記録_完了時刻の新しいほうが残り_片方だけにあればそれが残る", () => {
    const older = { ...record(1, "2026-10-01T00:00:00.000Z"), section: 0 };
    const newer = { ...record(2, "2026-10-02T00:00:00.000Z"), section: 1 };
    expect(mergeSectionProgress(progress({}, older), progress({}, newer)).last).toEqual(newer);
    expect(mergeSectionProgress(progress({}, newer), progress({}, older)).last).toEqual(newer);
    expect(mergeSectionProgress(progress({}), progress({}, older)).last).toEqual(older);
    expect(mergeSectionProgress(progress({}), progress({})).last).toBeUndefined();
  });

  it("統合_元の進捗を書き換えない", () => {
    const base = progress({ "0": record(3, "2026-10-01T00:00:00.000Z") });
    mergeSectionProgress(base, progress({ "1": record(2, "2026-10-02T00:00:00.000Z") }));
    expect(Object.keys(base.best)).toEqual(["0"]);
  });

  it("端末に保存_そのまま読み直せる", () => {
    const store = memoryStore();
    const saved = progress({ "2": record(4, "2026-10-01T00:00:00.000Z") });
    expect(saveSectionProgress(store, saved)).toBe(true);
    expect(loadSectionProgress(store, "TEST")).toEqual(saved);
    expect(loadSectionProgress(store, "OTHER")).toEqual({ examCode: "OTHER", best: {} });
  });
});

describe("以前の試験コードの記録の移行", () => {
  const legacy = { AIB: "AWS-AIB-C01" };
  const result = (examCode: string) => ({
    examCode,
    questionIds: ["AIB-0001"],
    answers: {},
    finishedAt: "2026-10-01T00:00:00.000Z",
  });

  it("以前のキーの記録_新しいキーへ移り_値の中のコードも新しくなり_以前のキーは消える", () => {
    const store = memoryStore({
      "mokumoku:v1:results:AIB": JSON.stringify([result("AIB")]),
      "mokumoku:v1:sections:AIB": JSON.stringify({ examCode: "AIB", best: {} }),
    });
    migrateLegacyExamKeys(store, legacy);
    expect(store.data.has("mokumoku:v1:results:AIB")).toBe(false);
    expect(loadResults(store, "AWS-AIB-C01")).toEqual([result("AWS-AIB-C01")]);
    expect(loadSectionProgress(store, "AWS-AIB-C01")).toEqual({ examCode: "AWS-AIB-C01", best: {} });
  });

  it("新しいキーにすでに記録がある_それを残し_以前のキーだけ消す", () => {
    const store = memoryStore({
      "mokumoku:v1:results:AIB": JSON.stringify([result("AIB")]),
      "mokumoku:v1:results:AWS-AIB-C01": JSON.stringify([result("AWS-AIB-C01"), result("AWS-AIB-C01")]),
    });
    migrateLegacyExamKeys(store, legacy);
    expect(store.data.has("mokumoku:v1:results:AIB")).toBe(false);
    expect(loadResults(store, "AWS-AIB-C01")).toHaveLength(2);
  });

  it("値が読めない_以前のキーを消さない", () => {
    const store = memoryStore({ "mokumoku:v1:results:AIB": "{not json" });
    migrateLegacyExamKeys(store, legacy);
    expect(store.data.get("mokumoku:v1:results:AIB")).toBe("{not json");
    expect(store.data.has("mokumoku:v1:results:AWS-AIB-C01")).toBe(false);
  });

  it("記録がない・別の資格の記録_何もしない", () => {
    const store = memoryStore({ "mokumoku:v1:results:OTHER": "[]" });
    migrateLegacyExamKeys(store, legacy);
    expect([...store.data.keys()]).toEqual(["mokumoku:v1:results:OTHER"]);
  });
});

describe("端末の記録の持ち主の照合", () => {
  const A = "aaaaaaaaaaaaaaaa";
  const B = "bbbbbbbbbbbbbbbb";
  const result: Result = {
    examCode: "TEST",
    questionIds: ["TEST-0001"],
    answers: {},
    finishedAt: "2026-10-01T00:00:00.000Z",
  };

  it("資格ごとの記録_持ち主の印をキーに入れ_一致する記録だけを読む", () => {
    const device = memoryStore();
    expect(saveSession(ownedStore(device, A), session)).toBe(true);
    expect([...device.data.keys()]).toEqual([`mokumoku:v1:${A}:session:TEST`]);
    expect(loadSession(ownedStore(device, A), "TEST")).toEqual(session);
    expect(loadSession(ownedStore(device, B), "TEST")).toBeNull();
  });

  it("5 種類の記録_どれも持ち主ごとに分かれ_別のアカウントの記録を上書きしない", () => {
    const device = memoryStore();
    const a = ownedStore(device, A);
    const b = ownedStore(device, B);
    saveSession(a, session);
    saveResult(a, result);
    saveStageCheck(a, "TEST", { unitId: "basics", order: 1, percent: 100, passed: true, finishedAt: "x" });
    saveSectionProgress(a, { examCode: "TEST", best: { "0": { correct: 5, total: 5, finishedAt: "x" } } });
    saveConditions(a, "TEST", {
      target: "all",
      domains: [],
      difficulties: [],
      count: 10,
      preferFewer: false,
      reveal: "end",
      includeFreeText: false,
    });
    saveSession(b, { ...session, index: 0 });
    expect(loadSession(a, "TEST")?.index).toBe(1);
    expect(loadConditions(b, "TEST")).toBeNull();
    expect(loadResults(b, "TEST")).toEqual([]);
    expect(passedStages(loadStageProgress(b, "TEST"), "basics")).toEqual([]);
    expect(loadSectionProgress(b, "TEST").best).toEqual({});
    const kinds = [...device.data.keys()]
      .filter((key) => key.startsWith(`mokumoku:v1:${A}:`))
      .map((k) => k.split(":")[3]);
    expect(kinds.sort()).toEqual(["conditions", "results", "sections", "session", "stages"]);
  });

  it("持ち主の印がない_資格ごとの記録を読まず_書かず_消さない", () => {
    const device = memoryStore();
    saveSession(ownedStore(device, A), session);
    for (const tag of [undefined, null]) {
      const store = ownedStore(device, tag);
      expect(loadSession(store, "TEST")).toBeNull();
      expect(saveResult(store, result)).toBe(false);
      clearSession(store, "TEST");
    }
    expect([...device.data.keys()]).toEqual([`mokumoku:v1:${A}:session:TEST`]);
  });

  it("表示の設定_照合の対象外で_持ち主によらず同じ値を読む", () => {
    const device = memoryStore();
    saveSettings(ownedStore(device, A), { shuffleChoices: true });
    expect([...device.data.keys()]).toEqual(["mokumoku:v1:settings"]);
    expect(loadSettings(ownedStore(device, B)).shuffleChoices).toBe(true);
    expect(loadSettings(ownedStore(device, null)).shuffleChoices).toBe(true);
  });

  it("印のない資格ごとの記録_読まずに消し_持ち主のある記録とほかの値は残す", () => {
    const device = memoryStore({
      "mokumoku:v1:session:TEST": "{}",
      "mokumoku:v1:results:TEST": "[]",
      "mokumoku:v1:stages:TEST": "{}",
      "mokumoku:v1:sections:TEST": "{}",
      "mokumoku:v1:conditions:TEST": "{}",
      [`mokumoku:v1:${A}:session:TEST`]: "{}",
      "mokumoku:v1:settings": "{}",
      "mokumoku:v1:theme": "dark",
    });
    const keys = () => [...device.data.keys()];
    removeUnownedRecords({
      get length() {
        return device.data.size;
      },
      key: (index) => keys()[index] ?? null,
      removeItem: device.removeItem,
    });
    expect(keys().sort()).toEqual(
      [`mokumoku:v1:${A}:session:TEST`, "mokumoku:v1:settings", "mokumoku:v1:theme"].sort(),
    );
  });

  it("持ち主の印_形の合わない値は_取れないもの(null)として扱う", () => {
    setStorageOwner("not-a-tag");
    expect(storageOwner()).toBeNull();
    setStorageOwner(A);
    expect(storageOwner()).toBe(A);
  });

  it("以前の試験コードの記録の移行_同じ持ち主の記録の中で移す", () => {
    const device = memoryStore({
      [`mokumoku:v1:${A}:sections:AIB`]: JSON.stringify({ examCode: "AIB", best: {} }),
      [`mokumoku:v1:${B}:sections:AIB`]: JSON.stringify({ examCode: "AIB", best: {} }),
    });
    migrateLegacyExamKeys(ownedStore(device, A), { AIB: "AWS-AIB-C01" });
    expect([...device.data.keys()].sort()).toEqual(
      [`mokumoku:v1:${A}:sections:AWS-AIB-C01`, `mokumoku:v1:${B}:sections:AIB`].sort(),
    );
  });
});

describe("出題の条件", () => {
  const conditions = {
    target: "all" as const,
    domains: ["D1"],
    difficulties: [],
    count: 10,
    preferFewer: true,
    reveal: "end" as const,
  };

  it("自由記述を含めるかを保存する_読み直すと同じ値になる", () => {
    const store = memoryStore();
    saveConditions(store, "TEST", { ...conditions, includeFreeText: true });
    expect(loadConditions(store, "TEST")?.includeFreeText).toBe(true);
  });

  it("自由記述の項目がない保存済みの条件_含めないとして読み_ほかの値は保つ", () => {
    const store = memoryStore();
    saveConditions(store, "TEST", { ...conditions, includeFreeText: true });
    const [key, value] = [...store.data.entries()][0] as [string, string];
    const { includeFreeText: _, ...legacy } = JSON.parse(value);
    store.setItem(key, JSON.stringify(legacy));
    expect(loadConditions(store, "TEST")).toEqual({ ...conditions, includeFreeText: false });
  });
});
