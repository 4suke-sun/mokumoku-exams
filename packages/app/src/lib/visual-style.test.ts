import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "./storage.ts";
import {
  DEFAULT_STYLE,
  effectsEnabled,
  loadStyle,
  parseStyle,
  STYLE_KEY,
  saveStyle,
  shouldShowConfetti,
} from "./visual-style.ts";

function memoryStore(initial: Record<string, string> = {}): KeyValueStore {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

const brokenStore: KeyValueStore = {
  getItem: () => {
    throw new Error("denied");
  },
  setItem: () => {
    throw new Error("denied");
  },
  removeItem: () => {
    throw new Error("denied");
  },
};

describe("parseStyle", () => {
  it("simple_そのまま返す", () => {
    expect(parseStyle("simple")).toBe("simple");
  });

  it("rich・未保存・知らない値_既定のリッチにする", () => {
    expect(DEFAULT_STYLE).toBe("rich");
    expect(parseStyle("rich")).toBe("rich");
    expect(parseStyle(null)).toBe("rich");
    expect(parseStyle("fancy")).toBe("rich");
  });
});

describe("loadStyle / saveStyle", () => {
  it("保存した選択を読み戻す", () => {
    const store = memoryStore();
    saveStyle(store, "simple");
    expect(store.getItem(STYLE_KEY)).toBe("simple");
    expect(loadStyle(store)).toBe("simple");
  });

  it("保存が禁止されている_例外を出さず_既定を返す", () => {
    expect(() => saveStyle(brokenStore, "simple")).not.toThrow();
    expect(loadStyle(brokenStore)).toBe("rich");
  });
});

describe("effectsEnabled", () => {
  it("リッチで_動きを減らす設定でない_演出を出す", () => {
    expect(effectsEnabled("rich", false)).toBe(true);
  });

  it("シンプル_演出を出さない", () => {
    expect(effectsEnabled("simple", false)).toBe(false);
  });

  it("動きを減らす設定_スタイルにかかわらず演出を出さない", () => {
    expect(effectsEnabled("rich", true)).toBe(false);
    expect(effectsEnabled("simple", true)).toBe(false);
  });
});

describe("shouldShowConfetti", () => {
  it("リッチで_合格ラインに届いた_出す", () => {
    expect(shouldShowConfetti("rich", false, true)).toBe(true);
  });

  it("合格ラインに届いていない_出さない", () => {
    expect(shouldShowConfetti("rich", false, false)).toBe(false);
  });

  it("シンプル_出さない", () => {
    expect(shouldShowConfetti("simple", false, true)).toBe(false);
  });

  it("動きを減らす設定_スタイルにかかわらず出さない", () => {
    expect(shouldShowConfetti("rich", true, true)).toBe(false);
    expect(shouldShowConfetti("simple", true, true)).toBe(false);
  });
});
