import { describe, expect, it } from "vitest";
import { startSession } from "./start-session.ts";
import { type KeyValueStore, loadSession, saveSettings } from "./storage.ts";

function memoryStore(): KeyValueStore {
  const data = new Map<string, string>();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

const items = [
  { questionId: "SAMPLE-0001", choiceKeys: ["A", "B"] },
  { questionId: "SAMPLE-0002", choiceKeys: ["A", "B"] },
];
const NOW = new Date("2026-10-15T00:00:00.000Z");

describe("出題を始める", () => {
  it("保存できる_出題の画面の場所を返し_端末に出題の状態を残す", () => {
    const store = memoryStore();
    expect(startSession(store, "EX-SMP-XX", items, {}, () => 0, NOW)).toBe("/exams/EX-SMP-XX/play");
    const saved = loadSession(store, "EX-SMP-XX");
    expect(saved?.questionIds).toEqual(["SAMPLE-0001", "SAMPLE-0002"]);
    expect(saved?.reveal).toBeUndefined();
    expect(saved?.section).toBeUndefined();
  });

  it("1 問ごとの表示を選んでいる_その表示と印を付けて残す", () => {
    const store = memoryStore();
    saveSettings(store, { shuffleChoices: false, reveal: "each" });
    startSession(store, "EX-SMP-XX", items, { section: 2 }, () => 0, NOW);
    expect(loadSession(store, "EX-SMP-XX")).toMatchObject({ reveal: "each", section: 2 });
  });

  it("端末に保存できない_null を返す", () => {
    const store: KeyValueStore = {
      ...memoryStore(),
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(startSession(store, "EX-SMP-XX", items, {}, () => 0, NOW)).toBeNull();
  });
});
