import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  emptyLedger,
  LedgerError,
  type LedgerFile,
  ledgerPath,
  parseLedger,
  readLedger,
  type SourceEntry,
  serializeLedger,
  usableSources,
  writeLedger,
} from "./ledger.ts";
import { entry } from "./test-helpers.ts";

const CODE = "AWS-AIB-C01";

function ledger(sources: SourceEntry[]): LedgerFile {
  return { ...emptyLedger(CODE), sources };
}

describe("台帳のスキーマ", () => {
  it("正しい台帳_通す", () => {
    expect(() => parseLedger(ledger([entry()]))).not.toThrow();
  });

  it.each<[string, Partial<SourceEntry>]>([
    ["https 以外の URL", { url: "http://docs.aws.amazon.com/a" }],
    ["許可外のドメイン", { url: "https://unlisted.example.com/a" }],
    ["ハッシュの形でない", { contentHash: "xyz" }],
    ["日付の形でない", { fetchedAt: "2026/10/01" }],
    ["未知の種別", { kind: "blog" as SourceEntry["kind"] }],
    ["理由コードに文が入る", { checks: [{ name: "official", result: "fail", reason: "Long Sentence With Spaces" }] }],
  ])("不正な値_%s で失敗し、場所だけを持つ", (_, overrides) => {
    try {
      parseLedger(ledger([entry(overrides)]));
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(LedgerError);
      expect(JSON.stringify((error as LedgerError).paths)).not.toContain("example.com");
    }
  });

  it("欠けた項目_失敗する", () => {
    const { status: _, ...missing } = entry();
    expect(() => parseLedger(ledger([missing as SourceEntry]))).toThrow(LedgerError);
  });

  it("本文らしい長い言い換え・引用_失敗する", () => {
    const claim = (paraphrase: string, quotes: string[] = []) =>
      ledger([entry({ claims: [{ id: "c1", paraphrase, quotes, factRefs: [] }] })]);
    expect(() => parseLedger(claim("短い言い換えです。"))).not.toThrow();
    expect(() => parseLedger(claim("あ".repeat(201)))).toThrow(LedgerError);
    expect(() => parseLedger(claim(Array.from({ length: 36 }, () => "word").join(" ")))).toThrow(LedgerError);
    expect(() => parseLedger(claim("ok", ["あ".repeat(31)]))).toThrow(LedgerError);
    expect(() =>
      parseLedger(claim("ok", ["あ".repeat(30), "い".repeat(30), "う".repeat(30), "え".repeat(30)])),
    ).toThrow(LedgerError);
  });

  it("同じ URL の重複_失敗する", () => {
    expect(() => parseLedger(ledger([entry(), entry()]))).toThrow(LedgerError);
  });
});

describe("台帳の読み書き", () => {
  it("往復しても内容と順序が変わらず、並びとキーの順序が固定される", () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-ledger-"));
    const path = ledgerPath(dir, CODE);
    expect(path.endsWith("aws-aib-c01.json")).toBe(true);
    const b = entry({ url: "https://docs.aws.amazon.com/b" });
    const a = entry({
      url: "https://docs.aws.amazon.com/a",
      checks: [
        { name: "liveness", result: "pass" },
        { name: "official", result: "pass" },
      ],
      claims: [
        { id: "c2", paraphrase: "二つ目", quotes: [], factRefs: ["f2", "f1", "f1"] },
        { id: "c1", paraphrase: "一つ目", quotes: [], factRefs: [] },
      ],
    });
    writeLedger(path, { ...ledger([b, a]), recheck: { facts: ["f2", "f1", "f2"], questions: [] } });
    const first = readFileSync(path, "utf8");
    const read = readLedger(path, CODE);
    expect(read.sources.map((s) => s.url)).toEqual(["https://docs.aws.amazon.com/a", "https://docs.aws.amazon.com/b"]);
    expect(read.sources[0]?.checks.map((c) => c.name)).toEqual(["official", "liveness"]);
    expect(read.sources[0]?.claims.map((c) => c.id)).toEqual(["c1", "c2"]);
    expect(read.sources[0]?.claims[1]?.factRefs).toEqual(["f1", "f2"]);
    expect(read.recheck.facts).toEqual(["f1", "f2"]);
    writeLedger(path, read);
    expect(readFileSync(path, "utf8")).toBe(first);
    expect(first.endsWith("}\n")).toBe(true);
    expect(serializeLedger(read)).toBe(first);
    // 一時ファイルを残さない
    expect(readdirSync(dir)).toEqual(["aws-aib-c01.json"]);
  });

  it("ファイルがない_空の台帳。資格コードが違う・壊れた JSON_失敗する", () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-ledger-"));
    expect(readLedger(join(dir, "none.json"), CODE)).toEqual(emptyLedger(CODE));
    const path = join(dir, "x.json");
    writeFileSync(path, serializeLedger(emptyLedger("EX-SMP-XX")));
    expect(() => readLedger(path, CODE)).toThrow(LedgerError);
    writeFileSync(path, "{ broken");
    expect(() => readLedger(path, CODE)).toThrow(LedgerError);
  });

  it("台帳に本文の項目を持たない_スキーマに未知の項目を足せない", () => {
    expect(() => parseLedger(ledger([{ ...entry(), body: "x" } as SourceEntry]))).toThrow(LedgerError);
  });

  it("使える出典_active だけ", () => {
    const l = ledger([entry(), entry({ url: "https://docs.aws.amazon.com/b", status: "needs-review" })]);
    expect(usableSources(l).map((s) => s.url)).toEqual(["https://docs.aws.amazon.com/guide/a.html"]);
  });
});
