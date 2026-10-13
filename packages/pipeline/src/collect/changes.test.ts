import { describe, expect, it } from "vitest";
import { clearRecheck, detectChanges, isBlockedForRecheck, markRecheck, traceAffected } from "./changes.ts";
import { emptyLedger, type LedgerFile } from "./ledger.ts";
import { entry } from "./test-helpers.ts";

const A = "https://docs.aws.amazon.com/a";
const B = "https://docs.aws.amazon.com/b";
const C = "https://docs.aws.amazon.com/c";
const H1 = "1".repeat(64);
const H2 = "2".repeat(64);

const ledger: LedgerFile = {
  ...emptyLedger("AWS-AIB-C01"),
  sources: [
    entry({
      url: A,
      contentHash: H1,
      claims: [{ id: "c1", paraphrase: "言い換え", quotes: [], factRefs: ["f1", "f2"] }],
    }),
    entry({ url: B, contentHash: H1, claims: [{ id: "c2", paraphrase: "言い換え", quotes: [], factRefs: ["f3"] }] }),
    entry({ url: C, contentHash: null, fetchedAt: null }),
  ],
};

describe("本文の変化の検知", () => {
  it("ハッシュが変わったものだけを変化ありにし、取得できないものは別に報告する", () => {
    const report = detectChanges(ledger.sources, [
      { url: A, hash: H2, fetchedAt: "2026-10-13", status: "active" },
      { url: B, hash: H1, fetchedAt: "2026-10-13", status: "active" },
      { url: C, hash: H2, fetchedAt: "2026-10-13", status: "active" },
      { url: "https://docs.aws.amazon.com/d", hash: null, fetchedAt: "2026-10-13", status: "unreachable" },
    ]);
    expect(report.changed).toEqual([
      { url: A, previousFetchedAt: "2026-10-01", fetchedAt: "2026-10-13", status: "active" },
    ]);
    expect(report.unconfirmed.map((r) => r.url)).toEqual(["https://docs.aws.amazon.com/d"]);
    // 報告は URL・日付・状態だけ
    expect(Object.keys(report.changed[0] ?? {}).sort()).toEqual(["fetchedAt", "previousFetchedAt", "status", "url"]);
  });

  it("変化した出典に結びつく事実カードと問題を、漏れなく洗い出す", () => {
    const affected = traceAffected(ledger, [A], { q1: ["f1"], q2: ["f9"], q3: ["f2", "f3"] });
    expect(affected).toEqual({ facts: ["f1", "f2"], questions: ["q1", "q3"] });
  });

  it("印を付けたものは、再検証が済むまで止める", () => {
    const marked = markRecheck(ledger, { facts: ["f1"], questions: ["q1"] });
    expect(isBlockedForRecheck(marked, { fact: "f1" })).toBe(true);
    expect(isBlockedForRecheck(marked, { question: "q1" })).toBe(true);
    expect(isBlockedForRecheck(marked, { fact: "f3" })).toBe(false);
    const cleared = clearRecheck(marked, { facts: ["f1"] });
    expect(isBlockedForRecheck(cleared, { fact: "f1" })).toBe(false);
    expect(isBlockedForRecheck(cleared, { question: "q1" })).toBe(true);
  });
});
