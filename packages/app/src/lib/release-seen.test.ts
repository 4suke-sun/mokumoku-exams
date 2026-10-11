import { describe, expect, it } from "vitest";
import {
  hasUnreadRelease,
  latestNotableVersion,
  loadSeenRelease,
  RELEASE_SEEN_KEY,
  saveSeenRelease,
} from "./release-seen.ts";

const release = (version: string, ...types: string[]) => ({ version, items: types.map((type) => ({ type })) });

function memoryStore() {
  const map = new Map<string, string>();
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => void map.set(key, value),
    removeItem: (key: string) => void map.delete(key),
  };
}

describe("latestNotableVersion", () => {
  it("開発者向けだけの版_飛ばす", () => {
    expect(latestNotableVersion([release("v0.3.0", "dev"), release("v0.2.0", "dev", "fix")])).toBe("v0.2.0");
  });

  it("利用者向けの版がない_null", () => {
    expect(latestNotableVersion([release("v0.1.0", "dev")])).toBeNull();
  });
});

describe("hasUnreadRelease", () => {
  it("まだ見ていない_未読", () => {
    expect(hasUnreadRelease(null, "v0.2.0")).toBe(true);
  });

  it("見た版がいちばん新しい_未読なし", () => {
    expect(hasUnreadRelease("v0.2.0", "v0.2.0")).toBe(false);
  });

  it("新しい版が出た_未読", () => {
    expect(hasUnreadRelease("v0.1.0", "v0.2.0")).toBe(true);
  });

  it("利用者向けの版がない_未読なし", () => {
    expect(hasUnreadRelease(null, null)).toBe(false);
  });
});

describe("保存", () => {
  it("見た版を保存して読み直せる", () => {
    const store = memoryStore();
    expect(loadSeenRelease(store)).toBeNull();
    saveSeenRelease(store, "v0.2.0");
    expect(store.getItem(RELEASE_SEEN_KEY)).toBe("v0.2.0");
    expect(loadSeenRelease(store)).toBe("v0.2.0");
  });

  it("保存が禁止されている_例外を出さない", () => {
    const store = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {},
    };
    expect(loadSeenRelease(store)).toBeNull();
    expect(() => saveSeenRelease(store, "v0.2.0")).not.toThrow();
  });
});
