import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyLedger, type LedgerFile } from "../collect/ledger.ts";
import { entry } from "../collect/test-helpers.ts";
import { emptyFacts, type FactCard } from "../facts/schema.ts";
import { card, DOC_HASH, DOC_URL } from "../facts/test-helpers.ts";
import {
  buildEntry,
  checkProvenance,
  emptyProvenance,
  ProvenanceError,
  type ProvenanceFile,
  parseProvenance,
  provenancePath,
  readProvenance,
  serializeProvenance,
  unprovenanced,
  writeProvenance,
} from "./provenance.ts";
import type { DraftRecord } from "./store.ts";

const FACT = "f-aaaaaaaaaaaa";
const ledger: LedgerFile = {
  ...emptyLedger("AWS-AIB-C01"),
  sources: [entry({ url: DOC_URL, contentHash: DOC_HASH, fetchedAt: "2026-10-01" })],
};
const facts = (cards: FactCard[]) => ({ ...emptyFacts("AWS-AIB-C01"), cards });
const file = (overrides: Partial<ProvenanceFile["entries"][number]> = {}): ProvenanceFile => ({
  examCode: "AWS-AIB-C01",
  entries: [
    {
      draftId: "d-111111111111",
      factIds: [FACT],
      sources: [{ url: DOC_URL, fetchedAt: "2026-10-01", contentHash: DOC_HASH }],
      ...overrides,
    },
  ],
});

describe("buildEntry", () => {
  it("事実カードと台帳がそろう_出典の URL、取得日、本文のハッシュを結ぶ", () => {
    const result = buildEntry("d-111111111111", [FACT], facts([card({ id: FACT })]), ledger);
    expect(result).toEqual({
      entry: {
        draftId: "d-111111111111",
        factIds: [FACT],
        sources: [{ url: DOC_URL, fetchedAt: "2026-10-01", contentHash: DOC_HASH }],
      },
    });
  });

  it("存在しない事実カード_fact-not-found", () => {
    expect(buildEntry("d-111111111111", [FACT], facts([]), ledger)).toEqual({ reasons: ["fact-not-found"] });
  });

  it("通過していない事実カード_fact-not-passed", () => {
    const result = buildEntry("d-111111111111", [FACT], facts([card({ id: FACT, status: "held" })]), ledger);
    expect(result).toEqual({ reasons: ["fact-not-passed"] });
  });

  it("台帳にない出典_source-not-in-ledger", () => {
    const result = buildEntry("d-111111111111", [FACT], facts([card({ id: FACT })]), emptyLedger("AWS-AIB-C01"));
    expect(result).toEqual({ reasons: ["source-not-in-ledger"] });
  });

  it("まだ取得していない出典_source-not-in-ledger", () => {
    const notFetched: LedgerFile = { ...ledger, sources: [entry({ url: DOC_URL, fetchedAt: null })] };
    expect(buildEntry("d-111111111111", [FACT], facts([card({ id: FACT })]), notFetched)).toEqual({
      reasons: ["source-not-in-ledger"],
    });
  });
});

describe("checkProvenance", () => {
  const good = facts([card({ id: FACT })]);

  it("正しい来歴_問題がない", () => {
    expect(checkProvenance(file(), good, "AWS")).toEqual([]);
  });

  it("存在しない事実カードを指す_fact-not-found", () => {
    expect(checkProvenance(file(), facts([]), "AWS")).toContainEqual({
      draftId: "d-111111111111",
      code: "fact-not-found",
    });
  });

  it("許可していないドメインの出典_検査で失敗する", () => {
    const f = file({ sources: [{ url: "https://example.com/doc", fetchedAt: "2026-10-01", contentHash: DOC_HASH }] });
    expect(checkProvenance(f, good, "AWS")).toEqual([
      { draftId: "d-111111111111", code: "source-url-host-not-allowed" },
    ]);
  });

  it("https でない出典_検査で失敗する", () => {
    const f = file({
      sources: [
        { url: "http://docs.aws.amazon.com/guide/service.html", fetchedAt: "2026-10-01", contentHash: DOC_HASH },
      ],
    });
    expect(checkProvenance(f, good, "AWS")).toEqual([{ draftId: "d-111111111111", code: "source-url-not-https" }]);
  });

  it("別のベンダーの出典_source-vendor-mismatch", () => {
    expect(checkProvenance(file(), good, "Other")).toEqual([
      { draftId: "d-111111111111", code: "source-vendor-mismatch" },
    ]);
  });

  it("根拠の事実カードにない出典_source-not-from-facts", () => {
    const f = file({
      sources: [{ url: "https://docs.aws.amazon.com/other/page.html", fetchedAt: "2026-10-01", contentHash: DOC_HASH }],
    });
    expect(checkProvenance(f, good, "AWS")).toEqual([{ draftId: "d-111111111111", code: "source-not-from-facts" }]);
  });
});

describe("unprovenanced", () => {
  const record = (id: string, status: DraftRecord["status"]): DraftRecord => ({
    id,
    planItemId: "p-aaaaaaaaaaaa",
    domain: "domain1",
    difficulty: "easy",
    status,
    reasons: [],
    warnings: [],
    draft: null,
  });

  it("来歴のない通過済みと保留の下書き_一覧に出る(不採用は出ない)", () => {
    const drafts = [
      record("d-111111111111", "passed"),
      record("d-222222222222", "passed"),
      record("d-333333333333", "held"),
      record("d-444444444444", "rejected"),
    ];
    expect(unprovenanced(drafts, file())).toEqual(["d-222222222222", "d-333333333333"]);
  });

  it("すべてに来歴がある_空", () => {
    expect(unprovenanced([record("d-111111111111", "passed")], file())).toEqual([]);
  });
});

describe("来歴の読み書き", () => {
  it("書いて読み戻す_並びが固定され_本文を含まない", () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-prov-"));
    const path = provenancePath(dir, "AWS-AIB-C01");
    const two: ProvenanceFile = {
      examCode: "AWS-AIB-C01",
      entries: [
        { draftId: "d-bbbbbbbbbbbb", factIds: [FACT], sources: file().entries[0]?.sources ?? [] },
        { draftId: "d-aaaaaaaaaaaa", factIds: [FACT], sources: file().entries[0]?.sources ?? [] },
      ],
    };
    writeProvenance(path, two);
    expect(readProvenance(path, "AWS-AIB-C01").entries.map((e) => e.draftId)).toEqual([
      "d-aaaaaaaaaaaa",
      "d-bbbbbbbbbbbb",
    ]);
    expect(readFileSync(path, "utf8")).toBe(serializeProvenance(two));
  });

  it("ファイルがない_空の来歴", () => {
    expect(readProvenance("/nonexistent/provenance.json", "AWS-AIB-C01")).toEqual(emptyProvenance("AWS-AIB-C01"));
  });

  it("本文のような未知の項目を持つ_落ちる", () => {
    const raw = { examCode: "AWS-AIB-C01", entries: [{ ...file().entries[0], claim: "主張の写し" }] };
    expect(() => parseProvenance(raw)).toThrow(ProvenanceError);
  });

  it("下書きの ID が重複する_落ちる", () => {
    const e = file().entries[0] as ProvenanceFile["entries"][number];
    expect(() => parseProvenance({ examCode: "AWS-AIB-C01", entries: [e, e] })).toThrow(ProvenanceError);
  });

  it("別の資格の来歴を読む_落ちる", () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-prov-"));
    const path = provenancePath(dir, "AWS-AIB-C01");
    writeProvenance(path, file());
    expect(() => readProvenance(path, "AWS-CLF-C02")).toThrow(ProvenanceError);
  });
});
