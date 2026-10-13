import { chmodSync, existsSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BodyCache } from "./cache.ts";
import { sha256 } from "./fetcher.ts";

const DAY = 24 * 60 * 60 * 1000;
const start = Date.parse("2026-10-01T00:00:00Z");

function setup(options = { retentionDays: 30, maxBytes: 1000 }) {
  const dir = join(mkdtempSync(join(tmpdir(), "pipeline-cache-")), "cache");
  let now = start;
  const cache = new BodyCache(dir, options, () => now);
  return { dir, cache, advance: (ms: number) => (now += ms) };
}

describe("本文のキャッシュ", () => {
  it("ハッシュをキーに書いて読める", () => {
    const { cache } = setup();
    const body = Buffer.from("synthetic body");
    const hash = cache.write(body);
    expect(hash).toBe(sha256(body));
    expect(cache.has(hash)).toBe(true);
    expect(cache.read(hash)?.equals(body)).toBe(true);
    expect(cache.read("0".repeat(64))).toBeNull();
  });

  it("ハッシュの形でないキー_受け付けない(置き場の外を指せない)", () => {
    const { cache } = setup();
    expect(() => cache.has("../x")).toThrow();
  });

  it("中身が壊れたもの_読まずに消す", () => {
    const { dir, cache } = setup();
    const hash = cache.write(Buffer.from("a"));
    writeFileSync(join(dir, `${hash}.body`), "tampered");
    expect(cache.read(hash)).toBeNull();
    expect(cache.has(hash)).toBe(false);
  });

  it("書き込みの途中で失敗_一時ファイルも本体も残さない", () => {
    const { dir, cache } = setup();
    cache.write(Buffer.from("first"));
    chmodSync(dir, 0o500);
    try {
      expect(() => cache.write(Buffer.from("second"))).toThrow();
    } finally {
      chmodSync(dir, 0o700);
    }
    expect(readdirSync(dir).filter((n) => n.endsWith(".tmp"))).toEqual([]);
    expect(cache.has(sha256(Buffer.from("second")))).toBe(false);
  });

  it("掃除_保持期間を過ぎたものと、書きかけの一時ファイルを消す", () => {
    const { dir, cache, advance } = setup();
    const old = cache.write(Buffer.from("old"));
    advance(20 * DAY);
    const fresh = cache.write(Buffer.from("fresh"));
    writeFileSync(join(dir, "left.tmp"), "partial");
    advance(15 * DAY);
    expect(cache.sweep()).toBe(2);
    expect(cache.has(old)).toBe(false);
    expect(cache.has(fresh)).toBe(true);
    expect(existsSync(join(dir, "left.tmp"))).toBe(false);
  });

  it("掃除_容量の上限を超えたら、古いものから消す。読んだものは新しい扱い", () => {
    const { cache, advance } = setup({ retentionDays: 30, maxBytes: 250 });
    const a = cache.write(Buffer.alloc(100, 1));
    advance(1000);
    const b = cache.write(Buffer.alloc(100, 2));
    advance(1000);
    cache.read(a);
    advance(1000);
    const c = cache.write(Buffer.alloc(100, 3));
    expect(cache.sweep()).toBe(1);
    expect(cache.has(b)).toBe(false);
    expect(cache.has(a)).toBe(true);
    expect(cache.has(c)).toBe(true);
  });

  it("置き場がまだない_掃除は何もしない", () => {
    const { cache } = setup();
    expect(cache.sweep()).toBe(0);
  });
});
