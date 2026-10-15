import { describe, expect, it, vi } from "vitest";
import { marksIfAny, recordSessionChecks, resultOf, saveFinishedResult } from "./finish-session.ts";
import { newSession } from "./quiz.ts";
import { type KeyValueStore, loadResults, loadSectionProgress, loadStageProgress, type Session } from "./storage.ts";

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

const questions = [
  { questionId: "SAMPLE-0001", questionType: "single" as const, correctAnswers: ["A"] },
  { questionId: "SAMPLE-0002", questionType: "single" as const, correctAnswers: ["B"] },
];
const NOW = new Date("2026-10-15T00:00:00.000Z");

function answered(marks: Partial<Session> = {}): Session {
  const session = newSession(
    "EX-SMP-XX",
    questions.map((q) => ({ questionId: q.questionId, choiceKeys: ["A", "B"] })),
    { shuffleChoices: false },
    () => 0,
    NOW,
  );
  return { ...session, answers: { "SAMPLE-0001": ["A"], "SAMPLE-0002": ["A"] }, ...marks };
}

describe("結果の組み立て", () => {
  it("印がない_印の項目を持たない_印があれば残す", () => {
    expect(marksIfAny([false, false])).toBeUndefined();
    expect(marksIfAny([false, true])).toEqual([false, true]);
    const result = resultOf(answered(), {
      finishedAt: NOW,
      timesMs: [1, 2],
      unsure: [true, false],
      flagged: [false, false],
    });
    expect(result).toMatchObject({
      examCode: "EX-SMP-XX",
      questionIds: ["SAMPLE-0001", "SAMPLE-0002"],
      finishedAt: NOW.toISOString(),
      timesMs: [1, 2],
      unsure: [true, false],
    });
    expect(result.flagged).toBeUndefined();
  });
});

describe("結果の保存", () => {
  const result = resultOf(answered(), { finishedAt: NOW, timesMs: [1, 2], unsure: [], flagged: [] });

  it("アカウントに保存できる_端末には残さない", async () => {
    const store = memoryStore();
    expect(await saveFinishedResult(store, result, async () => true)).toBe("server");
    expect(loadResults(store, "EX-SMP-XX")).toEqual([]);
  });

  it("アカウントに保存できない_端末に残す", async () => {
    const store = memoryStore();
    expect(await saveFinishedResult(store, result, async () => false)).toBe("local");
    expect(loadResults(store, "EX-SMP-XX")).toHaveLength(1);
  });

  it("どこにも残せない_失敗を返す", async () => {
    const store: KeyValueStore = {
      ...memoryStore(),
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(await saveFinishedResult(store, result, async () => false)).toBe("failed");
  });
});

describe("段階とセクションの記録", () => {
  it("段階の確認問題_正答率と合否を端末に残す", () => {
    const store = memoryStore();
    const put = vi.fn(async () => null);
    recordSessionChecks(store, answered({ stage: { unitId: "unit-a", order: 1 } }), questions, NOW.toISOString(), put);
    expect(loadStageProgress(store, "EX-SMP-XX").last).toMatchObject({ unitId: "unit-a", percent: 50, passed: false });
    expect(put).not.toHaveBeenCalled();
  });

  it("セクションの出題_正答数を端末に残し_サーバーにも送る", () => {
    const store = memoryStore();
    const put = vi.fn(async () => null);
    recordSessionChecks(store, answered({ section: 1 }), questions, NOW.toISOString(), put);
    expect(loadSectionProgress(store, "EX-SMP-XX").best["1"]).toMatchObject({ correct: 1, total: 2 });
    expect(put).toHaveBeenCalledWith({
      examCode: "EX-SMP-XX",
      best: { "1": { correct: 1, total: 2, finishedAt: NOW.toISOString() } },
      last: { correct: 1, total: 2, finishedAt: NOW.toISOString(), section: 1 },
    });
  });

  it("通常の出題_何も残さない", () => {
    const store = memoryStore();
    const put = vi.fn(async () => null);
    recordSessionChecks(store, answered(), questions, NOW.toISOString(), put);
    expect(put).not.toHaveBeenCalled();
  });
});
