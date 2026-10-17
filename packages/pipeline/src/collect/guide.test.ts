import { describe, expect, it } from "vitest";
import { diffWithMaster, type GuideExtract, importGuide } from "./guide.ts";
import { emptyLedger, type LedgerFile } from "./ledger.ts";
import { entry, fixture } from "./test-helpers.ts";

const GUIDE = "https://docs.aws.amazon.com/guide/index.html";
const HASH = "b".repeat(64);
const body = fixture("guide.html");

const ledger: LedgerFile = {
  ...emptyLedger("AWS-AIB-C01"),
  sources: [entry({ url: GUIDE, kind: "exam-guide", contentHash: HASH })],
};

function extract(overrides: Partial<GuideExtract> = {}): GuideExtract {
  return {
    examCode: "AWS-AIB-C01",
    sourceUrl: GUIDE,
    contentHash: HASH,
    pages: [],
    domains: [
      { number: 1, name: "アルファの分野", weightPercent: 60, scope: ["アルファの基本を説明できる"] },
      { number: 2, name: "ベータの分野", weightPercent: 40, scope: [] },
    ],
    ...overrides,
  };
}

describe("試験ガイドの取り込み", () => {
  it("正しい抽出_分野のコードと割合にして取り込む", () => {
    const r = importGuide(extract(), ledger, [], () => body, "2026-10-13");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.guide.domains.map((d) => [d.code, d.weight])).toEqual([
      ["domain1", 0.6],
      ["domain2", 0.4],
    ]);
    expect(r.guide.importedAt).toBe("2026-10-13");
  });

  it.each<[string, unknown, string]>([
    ["形が違う", { examCode: "AWS-AIB-C01" }, "extract-invalid"],
    ["資格が違う", extract({ examCode: "EX-SMP-XX" }), "exam-mismatch"],
    ["台帳にない出典", extract({ sourceUrl: "https://docs.aws.amazon.com/other" }), "source-not-in-ledger"],
    ["本文のハッシュが違う", extract({ contentHash: "c".repeat(64) }), "source-hash-mismatch"],
    [
      "番号が抜けている",
      extract({
        domains: [
          { number: 1, name: "a", weightPercent: 50, scope: [] },
          { number: 3, name: "b", weightPercent: 50, scope: [] },
        ],
      }),
      "domain-numbering",
    ],
    [
      "配点の合計が合わない",
      extract({
        domains: [
          { number: 1, name: "a", weightPercent: 60, scope: [] },
          { number: 2, name: "b", weightPercent: 30, scope: [] },
        ],
      }),
      "weight-sum-mismatch",
    ],
    [
      "本文の写し",
      extract({
        domains: [
          {
            number: 1,
            name: "a",
            weightPercent: 100,
            scope: ["Synthetic exam guide for tests Domain 1: Alpha topics"],
          },
        ],
      }),
      "verbatim-copy",
    ],
  ])("止める_%s", (_, raw, reason) => {
    expect(importGuide(raw, ledger, [], () => body, "2026-10-13")).toEqual({ ok: false, reason });
  });

  it("出典が active でない・本文がキャッシュにない_止める", () => {
    const review: LedgerFile = {
      ...ledger,
      sources: [entry({ url: GUIDE, kind: "exam-guide", contentHash: HASH, status: "needs-review" })],
    };
    expect(importGuide(extract(), review, [], () => body, "2026-10-13")).toEqual({
      ok: false,
      reason: "source-not-active",
    });
    expect(importGuide(extract(), ledger, [], () => null, "2026-10-13")).toEqual({
      ok: false,
      reason: "body-not-cached",
    });
  });
});

describe("試験ガイドの続きのページ", () => {
  const PAGE = "https://docs.aws.amazon.com/guide/detail/one.html";
  const PAGE_HASH = "d".repeat(64);
  const pageBody = fixture("doc.html");
  const withPage: LedgerFile = {
    ...ledger,
    sources: [...ledger.sources, entry({ url: PAGE, contentHash: PAGE_HASH })],
  };
  const read = (hash: string) => ({ [HASH]: body, [PAGE_HASH]: pageBody })[hash] ?? null;
  const pages = [{ url: PAGE, contentHash: PAGE_HASH }];

  it("計画のページを材料にした抽出_ページとハッシュを記録して取り込む", () => {
    const r = importGuide(extract({ pages }), withPage, [PAGE], read, "2026-10-13");
    expect(r.ok && r.guide.pages).toEqual(pages);
  });

  it("計画のページが抽出にない・計画にないページ_止める", () => {
    expect(importGuide(extract(), withPage, [PAGE], read, "2026-10-13")).toEqual({
      ok: false,
      reason: "page-mismatch",
    });
    expect(importGuide(extract({ pages }), withPage, [], read, "2026-10-13")).toEqual({
      ok: false,
      reason: "page-mismatch",
    });
  });

  it("ページのハッシュが台帳と違う・本文がない_止める", () => {
    const stale = extract({ pages: [{ url: PAGE, contentHash: "e".repeat(64) }] });
    expect(importGuide(stale, withPage, [PAGE], read, "2026-10-13")).toEqual({
      ok: false,
      reason: "source-hash-mismatch",
    });
    const noPage = (hash: string) => (hash === HASH ? body : null);
    expect(importGuide(extract({ pages }), withPage, [PAGE], noPage, "2026-10-13")).toEqual({
      ok: false,
      reason: "body-not-cached",
    });
  });

  it("言い換えがページの本文の写し_止める", () => {
    const copied = extract({
      pages,
      domains: [
        {
          number: 1,
          name: "a",
          weightPercent: 100,
          scope: ["Synthetic text without an update date. Feature X is deprecated in favor"],
        },
      ],
    });
    expect(importGuide(copied, withPage, [PAGE], read, "2026-10-13")).toEqual({ ok: false, reason: "verbatim-copy" });
  });
});

describe("資格マスタとの突き合わせ", () => {
  it("分野の過不足と配点のずれを報告する", () => {
    const r = importGuide(extract(), ledger, [], () => body, "2026-10-13");
    if (!r.ok) throw new Error("取り込めない");
    expect(
      diffWithMaster(r.guide, [
        { code: "domain1", weight: 0.5 },
        { code: "domain3", weight: 0.5 },
      ]),
    ).toEqual({
      missingInMaster: ["domain2"],
      extraInMaster: ["domain3"],
      weightMismatch: [{ code: "domain1", guide: 0.6, master: 0.5 }],
    });
    expect(
      diffWithMaster(r.guide, [
        { code: "domain1", weight: 0.6 },
        { code: "domain2", weight: 0.4 },
      ]),
    ).toEqual({
      missingInMaster: [],
      extraInMaster: [],
      weightMismatch: [],
    });
  });
});
