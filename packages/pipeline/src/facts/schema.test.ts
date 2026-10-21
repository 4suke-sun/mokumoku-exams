import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  checkFactsContext,
  emptyFacts,
  FactCardSchema,
  FactsError,
  parseFacts,
  readFacts,
  serializeFacts,
  writeFacts,
} from "./schema.ts";
import { card, DOC_URL } from "./test-helpers.ts";

const CODE = "AWS-AIB-C01";

describe("事実カードのスキーマ", () => {
  it("正しいカード_通す", () => {
    expect(FactCardSchema.safeParse(card()).success).toBe(true);
  });

  it.each<[string, (c: ReturnType<typeof card>) => unknown]>([
    ["主張がない", (c) => ({ ...c, claim: undefined })],
    ["根拠がない", (c) => ({ ...c, sources: [] })],
    ["確度がない", (c) => ({ ...c, confidence: undefined })],
    ["分野がない", (c) => ({ ...c, domain: undefined })],
    ["未知の項目", (c) => ({ ...c, body: "x" })],
    ["確度が未知の値", (c) => ({ ...c, confidence: "certain" })],
    ["分野のコードの形", (c) => ({ ...c, domain: "Domain 1" })],
    ["http の URL", (c) => ({ ...c, sources: [{ ...c.sources[0], url: "http://docs.aws.amazon.com/a" }] })],
    [
      "許可していないドメインの URL",
      (c) => ({ ...c, sources: [{ ...c.sources[0], url: "https://unlisted.example.com/a" }] }),
    ],
    ["本文のハッシュの形", (c) => ({ ...c, sources: [{ ...c.sources[0], contentHash: "xyz" }] })],
    ["言い換えが長すぎる", (c) => ({ ...c, claim: "あ".repeat(201) })],
    [
      "台帳に引用がある",
      (c) => ({ ...c, sources: [{ ...c.sources[0], anchor: { heading: "quotas", quote: "up to 100 buckets" } }] }),
    ],
    ["リージョンの形", (c) => ({ ...c, scope: { region: "US East" } })],
  ])("不正_%s で失敗する", (_, mutate) => {
    expect(FactCardSchema.safeParse(mutate(card())).success).toBe(false);
  });

  it("上限ちょうどの言い換え_通す", () => {
    expect(FactCardSchema.safeParse(card({ claim: "あ".repeat(200) })).success).toBe(true);
  });
});

describe("事実カードの台帳", () => {
  it("カードの ID が重複している_失敗し、場所だけを持つ", () => {
    try {
      parseFacts({ ...emptyFacts(CODE), cards: [card(), card()] });
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(FactsError);
      expect((error as FactsError).paths).toEqual(["cards.1.id"]);
    }
  });

  it("資格マスタにない分野・試験ガイドにない項目の添字_場所を返す", () => {
    const file = {
      ...emptyFacts(CODE),
      cards: [card({ id: "f-a", domain: "domain9" }), card({ id: "f-b", scopeItems: [0, 3] })],
    };
    expect(checkFactsContext(file, { domains: ["domain1"], scopeSizes: { domain1: 2 } })).toEqual([
      "cards.0.domain",
      "cards.1.scopeItems.1",
    ]);
    expect(checkFactsContext(file, { domains: ["domain1", "domain9"], scopeSizes: null })).toEqual([]);
  });

  it("書き出し_並びとキーの順を固定し、本文は含まない。読み戻せる", () => {
    const file = {
      ...emptyFacts(CODE),
      cards: [card({ id: "f-b", reasons: ["z-reason", "a-reason"] }), card({ id: "f-a", scopeItems: [3, 1, 1] })],
    };
    const text = serializeFacts(file);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.indexOf('"f-a"')).toBeLessThan(text.indexOf('"f-b"'));
    expect(text).toContain(DOC_URL);
    expect(text).not.toContain("Synthetic");
    const path = join(mkdtempSync(join(tmpdir(), "pipeline-facts-")), "facts.json");
    writeFacts(path, file);
    expect(readFileSync(path, "utf8")).toBe(text);
    expect(readFacts(path, CODE).cards.map((c) => c.id)).toEqual(["f-a", "f-b"]);
    expect(() => readFacts(path, "EX-SMP-XX")).toThrow(FactsError);
  });

  it("ファイルがない_空の台帳", () => {
    expect(readFacts(join(tmpdir(), "no-such-facts-file.json"), CODE)).toEqual(emptyFacts(CODE));
  });
});
