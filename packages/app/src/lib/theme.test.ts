import { describe, expect, it } from "vitest";
import type { KeyValueStore } from "./storage.ts";
import { loadTheme, parseTheme, saveTheme, THEME_KEY } from "./theme.ts";

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

describe("parseTheme", () => {
  it("light_そのまま返す", () => {
    expect(parseTheme("light")).toBe("light");
  });

  it("dark_そのまま返す", () => {
    expect(parseTheme("dark")).toBe("dark");
  });

  it("保存なし_端末に従う", () => {
    expect(parseTheme(null)).toBe("system");
  });

  it("知らない値_端末に従う", () => {
    expect(parseTheme("sepia")).toBe("system");
  });
});

describe("saveTheme と loadTheme", () => {
  it("保存した選択_読み出せる", () => {
    const store = memoryStore();
    saveTheme(store, "dark");
    expect(loadTheme(store)).toBe("dark");
    expect(store.getItem(THEME_KEY)).toBe("dark");
  });

  it("保存が禁止された環境_例外にならず端末に従う", () => {
    expect(() => saveTheme(brokenStore, "dark")).not.toThrow();
    expect(loadTheme(brokenStore)).toBe("system");
  });
});
