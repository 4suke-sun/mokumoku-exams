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
    services: [],
    excludedServices: [],
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
      examMismatch: [],
      examMissingInMaster: [],
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
      examMismatch: [],
      examMissingInMaster: [],
    });
  });
});

const master = [
  { code: "domain1", weight: 0.6 },
  { code: "domain2", weight: 0.4 },
];
const values = { officialQuestionCount: 65, officialTimeMinutes: 130, passingScore: 700, totalScore: 1000 };
const full = { questionCount: 65, scoredQuestionCount: 50, timeMinutes: 130, passingScore: 700, totalScore: 1000 };

function imported(overrides: Partial<GuideExtract>) {
  const r = importGuide(extract(overrides), ledger, [], () => body, "2026-10-13");
  if (!r.ok) throw new Error(`取り込めない: ${r.reason}`);
  return r.guide;
}

describe("試験ガイドの本番の値(出題数・試験時間・合格点・満点)", () => {
  it("ガイドが示す値_台帳に数値だけを持つ。示さない項目は持たない", () => {
    expect(imported(full).exam).toEqual(full);
    expect(imported({ timeMinutes: 90 }).exam).toEqual({ timeMinutes: 90 });
    expect(imported({}).exam).toBeUndefined();
  });

  it("値の形が違う_0 以下・小数・文字は、取り込みで止まる", () => {
    for (const bad of [0, -1, 1.5, "65"]) {
      expect(importGuide(extract({ questionCount: bad as number }), ledger, [], () => body, "2026-10-13")).toEqual({
        ok: false,
        reason: "extract-invalid",
      });
    }
  });

  it("合格点が満点を超える・採点対象が総数を超える_取り込みで止まる(境界: ちょうどは通る)", () => {
    const run = (o: Partial<GuideExtract>) => importGuide(extract(o), ledger, [], () => body, "2026-10-13");
    expect(run({ passingScore: 1001, totalScore: 1000 })).toEqual({ ok: false, reason: "exam-values-invalid" });
    expect(run({ passingScore: 1000, totalScore: 1000 }).ok).toBe(true);
    expect(run({ scoredQuestionCount: 66, questionCount: 65 })).toEqual({ ok: false, reason: "exam-values-invalid" });
    expect(run({ scoredQuestionCount: 65, questionCount: 65 }).ok).toBe(true);
    // 片方だけ示すときは、比べない
    expect(run({ passingScore: 5000 }).ok).toBe(true);
  });

  it("本番の値は数値_本文の写しの検査の対象にしない", () => {
    expect(importGuide(extract({ questionCount: 85 }), ledger, [], () => "questionCount 85", "2026-10-13").ok).toBe(
      true,
    );
  });

  it("マスタと一致_差分なし", () => {
    const d = diffWithMaster(imported(full), master, values);
    expect(d.examMismatch).toEqual([]);
    expect(d.examMissingInMaster).toEqual([]);
  });

  it("マスタと食い違う_項目の名前と、ガイド・マスタの両方の値を出す", () => {
    const d = diffWithMaster(imported(full), master, { ...values, officialQuestionCount: 85, passingScore: 720 });
    expect(d.examMismatch).toEqual([
      { item: "出題数", guide: 65, master: 85 },
      { item: "合格点", guide: 700, master: 720 },
    ]);
  });

  it("ガイドが項目を示さない_その項目は比べない(マスタの値だけがあっても、差分にしない)", () => {
    const d = diffWithMaster(imported({ questionCount: 65 }), master, { ...values, officialQuestionCount: 65 });
    expect(d.examMismatch).toEqual([]);
    expect(d.examMissingInMaster).toEqual([]);
  });

  it("マスタに値がない(準備中の資格など)_ガイドの値を報告する", () => {
    const none = { officialQuestionCount: null, officialTimeMinutes: null, passingScore: null, totalScore: null };
    expect(diffWithMaster(imported(full), master, none).examMissingInMaster).toEqual([
      { item: "出題数", guide: 65 },
      { item: "試験時間", guide: 130 },
      { item: "合格点", guide: 700 },
      { item: "満点", guide: 1000 },
    ]);
    // マスタの値を渡さないときも、同じ
    expect(diffWithMaster(imported({ timeMinutes: 90 }), master).examMissingInMaster).toEqual([
      { item: "試験時間", guide: 90 },
    ]);
  });

  it("採点対象の問題数_出題数とは突き合わせない", () => {
    const d = diffWithMaster(imported({ scoredQuestionCount: 50 }), master, values);
    expect(d.examMismatch).toEqual([]);
    expect(d.examMissingInMaster).toEqual([]);
  });
});

describe("試験ガイドの対象サービスの一覧", () => {
  const services = "In-scope services: AWS Lambda, Amazon Simple Queue Service (Amazon SQS)";
  const run = (names: string[], text = services) =>
    importGuide(extract({ services: names }), ledger, [], () => text, "2026-10-13");

  it("本文に出る名前_そのまま台帳に持つ(本文の写しの検査の対象にしない)", () => {
    const r = run(["AWS Lambda", "Amazon Simple Queue Service (Amazon SQS)"]);
    expect(r.ok && r.guide.services).toEqual(["AWS Lambda", "Amazon Simple Queue Service (Amazon SQS)"]);
  });

  it("本文で改行をまたぐ名前_空白をそろえて比べ、通す", () => {
    expect(run(["AWS Lambda"], "AWS\n  Lambda").ok).toBe(true);
  });

  it("一覧が空_台帳に項目を持たない", () => {
    const r = run([]);
    expect(r.ok && "services" in r.guide).toBe(false);
  });

  it("本文にない名前_止める", () => {
    expect(run(["AWS Lambda", "Amazon Kinesis"])).toEqual({ ok: false, reason: "service-not-in-source" });
  });

  it("同じ名前が重なる_止める", () => {
    expect(run(["AWS Lambda", "AWS Lambda"])).toEqual({ ok: false, reason: "service-duplicate" });
  });

  describe("対象外サービスの一覧", () => {
    const text = "In scope: AWS Lambda. Out of scope: Amazon Kinesis, Amazon SageMaker";
    const runBoth = (names: string[], excluded: string[], body = text) =>
      importGuide(extract({ services: names, excludedServices: excluded }), ledger, [], () => body, "2026-10-13");

    it("本文に出る名前_台帳に持つ", () => {
      const r = runBoth(["AWS Lambda"], ["Amazon Kinesis", "Amazon SageMaker"]);
      expect(r.ok && r.guide.excludedServices).toEqual(["Amazon Kinesis", "Amazon SageMaker"]);
    });

    it("一覧が空_台帳に項目を持たない", () => {
      const r = runBoth(["AWS Lambda"], []);
      expect(r.ok && "excludedServices" in r.guide).toBe(false);
    });

    it("本文にない名前_止める", () => {
      expect(runBoth(["AWS Lambda"], ["Amazon Redshift"])).toEqual({ ok: false, reason: "service-not-in-source" });
    });

    it("同じ名前が重なる_止める", () => {
      expect(runBoth(["AWS Lambda"], ["Amazon Kinesis", "Amazon Kinesis"])).toEqual({
        ok: false,
        reason: "service-duplicate",
      });
    });

    it("対象と対象外の両方にある名前_止める", () => {
      expect(runBoth(["AWS Lambda", "Amazon Kinesis"], ["Amazon Kinesis"])).toEqual({
        ok: false,
        reason: "service-overlap",
      });
    });
  });

  it("名前のほかの文が入る(句点・日本語・長すぎる)_形の検査で止める", () => {
    for (const bad of ["AWS Lambda。サーバーレス", "ラムダ", `A${"a".repeat(80)}`]) {
      expect(run([bad])).toEqual({ ok: false, reason: "extract-invalid" });
    }
  });
});
