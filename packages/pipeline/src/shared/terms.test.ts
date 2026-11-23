import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { requestStyleGuides } from "../draft/guides.ts";
import { evaluateStyle, STYLE_RULES, STYLE_VERSION } from "../draft/style.ts";
import { choiceDraft } from "../draft/test-helpers.ts";
import { withTerms } from "../judge/criteria.ts";
import {
  findAvoidTerms,
  findUnexpandedAbbreviations,
  parseTerms,
  readTerms,
  TermsError,
  termsForCriteria,
  termsPath,
} from "./terms.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");

const DOC = `# 辞書

## 使う訳語と使わない訳語

| 使う語 | 使わない語 | 対象外の語 | 条件 |
| --- | --- | --- | --- |
| テーブル | 表 | 表形式、表示、代表 | テーブルの意味のとき |
| 古いバージョン | 古い版、より古い版 | | |

## 略語と正式名称

| 略語 | 正式名称 |
| --- | --- |
| SQS | Amazon Simple Queue Service |

## 補わない略語

| 略語 |
| --- |
| EC2 |
`;

const terms = parseTerms("X", DOC);

describe("parseTerms", () => {
  it("正しい表_使う語・使わない語・対象外の語・略語の対・補わない略語に読む", () => {
    expect(terms.entries).toHaveLength(2);
    expect(terms.entries[0]).toMatchObject({ use: "テーブル", avoid: ["表"], exempt: ["表形式", "表示", "代表"] });
    expect(terms.entries[1]?.avoid).toEqual(["古い版", "より古い版"]);
    expect(terms.pairs).toEqual([{ abbr: "SQS", full: "Amazon Simple Queue Service" }]);
    expect(terms.noExpand).toEqual(["EC2"]);
  });

  it("表のない節_空として扱う", () => {
    const empty = parseTerms("X", "# 辞書\n\n## 使う訳語と使わない訳語\n\n説明だけ。\n");
    expect(empty).toEqual({ vendor: "X", entries: [], pairs: [], noExpand: [] });
  });

  it("形の違う行_場所だけを示す TermsError にする", () => {
    const bad = DOC.replace("| SQS | Amazon Simple Queue Service |", "| 1SQS | Amazon Simple Queue Service(正式) |");
    expect(() => parseTerms("X", bad)).toThrow(TermsError);
    try {
      parseTerms("X", bad);
    } catch (error) {
      expect((error as TermsError).paths).toEqual(["略語と正式名称:14"]);
    }
  });

  it("使う語と使わない語が同じ_誤りにする", () => {
    expect(() =>
      parseTerms("X", DOC.replace("| 古いバージョン | 古い版、より古い版 |", "| 古い版 | 古い版 |")),
    ).toThrow(TermsError);
  });

  it("同じ略語が補う表と補わない表の両方にある_誤りにする", () => {
    expect(() => parseTerms("X", DOC.replace("| EC2 |", "| SQS |"))).toThrow(TermsError);
  });
});

describe("findAvoidTerms", () => {
  it("使わない語を含む文_見つける", () => {
    expect(findAvoidTerms("この表にデータを書き込みます。", terms)).toEqual(["表"]);
    expect(findAvoidTerms("より古い版のスナップショットを読みます。", terms)).toEqual(["古い版", "より古い版"]);
  });

  it("別の意味の語_対象外の語として止めない", () => {
    expect(findAvoidTerms("表形式で表示します。代表的な例です。", terms)).toEqual([]);
  });

  it("対象外の語と使わない語が同じ文にある_使わない語だけを見つける", () => {
    expect(findAvoidTerms("表示された表を見ます。", terms)).toEqual(["表"]);
  });

  it("使う語だけの文_止めない", () => {
    expect(findAvoidTerms("テーブルを古いバージョンへ戻します。", terms)).toEqual([]);
  });
});

describe("findUnexpandedAbbreviations", () => {
  const order = (...texts: string[]) => texts.map((text, i) => ({ path: `p${i}`, text }));

  it("初出に正式名称がない_その場所を返す", () => {
    expect(findUnexpandedAbbreviations(order("SQS を使います。", "SQS は再び出ます。"), terms)).toEqual(["p0"]);
  });

  it("初出に半角か全角の括弧で正式名称がある_止めない。2 回目以降は補わなくてよい", () => {
    expect(
      findUnexpandedAbbreviations(order("SQS(Amazon Simple Queue Service)を使います。", "SQS だけ。"), terms),
    ).toEqual([]);
    expect(findUnexpandedAbbreviations(order("SQS（Amazon Simple Queue Service）を使います。"), terms)).toEqual([]);
  });

  it("略語と括弧の間に空白がある_補えていないとして止める", () => {
    expect(findUnexpandedAbbreviations(order("SQS (Amazon Simple Queue Service)を使います。"), terms)).toEqual(["p0"]);
  });

  it("英数字につながる語_略語として数えない", () => {
    expect(findUnexpandedAbbreviations(order("SQSX と XSQS と SQS-FIFO と X-SQS の話です。"), terms)).toEqual([]);
  });

  it("略語が出ない_止めない。補わない略語は検査しない", () => {
    expect(findUnexpandedAbbreviations(order("EC2 だけの文です。"), terms)).toEqual([]);
  });
});

describe("判定の基準への足し込み", () => {
  const base = { path: "docs/exam-style/x.md", text: "## 判定の基準\n\n本文。", hash: "h" };

  it("使う語と使わない語の対がある_基準の末尾に足し_ハッシュが変わる", () => {
    const added = withTerms(base, terms);
    expect(added.text).toContain("「表」は使わず、「テーブル」を使う(テーブルの意味のとき)");
    expect(added.hash).not.toBe(base.hash);
    const first = terms.entries[0];
    if (first === undefined) throw new Error("辞書の最初の項目がない");
    const changed = withTerms(base, { ...terms, entries: [{ ...first, avoid: ["表", "図表のこと"] }] });
    expect(changed.hash).not.toBe(added.hash);
  });

  it("辞書がない、または対がない_基準をそのまま返す(略語は基準に載せない)", () => {
    expect(withTerms(base, null)).toBe(base);
    expect(withTerms(base, { ...terms, entries: [] })).toBe(base);
    expect(termsForCriteria({ ...terms, entries: [] })).toEqual([]);
  });
});

describe("取り込みの検査と規則の表", () => {
  const draft = (over: Parameters<typeof choiceDraft>[0] = {}) => choiceDraft(over);

  it("辞書がない_辞書を使う規則は何も止めない", () => {
    const verdict = evaluateStyle(draft({ questionText: "この表の SQS はどれですか。" }));
    expect(verdict.blockers.map((f) => f.rule)).not.toContain("avoid-term");
    expect(verdict.blockers.map((f) => f.rule)).not.toContain("abbr-first-use");
  });

  it("使わない語を含む下書き_avoid-term で止まる。場所だけを報告する", () => {
    const verdict = evaluateStyle(
      draft({ questionText: "この表にデータを書き込むとき、正しいものはどれですか。" }),
      undefined,
      {
        terms,
      },
    );
    expect(verdict.blockers).toContainEqual({ rule: "avoid-term", severity: "block", path: "questionText" });
  });

  it("初出で正式名称のない略語_abbr-first-use で止まる。補った下書きは通る", () => {
    const bad = draft({ questionText: "SQS を使うとき、正しいものはどれですか。" });
    expect(evaluateStyle(bad, undefined, { terms }).blockers.map((f) => f.rule)).toContain("abbr-first-use");
    const good = draft({ questionText: "SQS(Amazon Simple Queue Service)を使うとき、正しいものはどれですか。" });
    expect(evaluateStyle(good, undefined, { terms }).blockers.map((f) => f.rule)).not.toContain("abbr-first-use");
  });

  it("選択肢で最初に出る略語_設問文より後の選択肢の出現を初出として見る", () => {
    const d = draft({
      choices: [
        { key: "A", text: "SQS(Amazon Simple Queue Service)を使う" },
        { key: "B", text: "100 個" },
        { key: "C", text: "1,000 個" },
        { key: "D", text: "上限はない" },
      ],
      explanation:
        "SQS は使いません。Widget Store では、アカウントがリージョンごとに作れるバケットは 100 個までと定められています。",
    });
    expect(evaluateStyle(d, undefined, { terms }).blockers.map((f) => f.rule)).not.toContain("abbr-first-use");
  });

  it("規則の集合を変えた_STYLE_VERSION を上げた(5)", () => {
    expect(STYLE_VERSION).toBe(5);
    expect(STYLE_RULES.map((r) => r.name)).toEqual(expect.arrayContaining(["avoid-term", "abbr-first-use"]));
  });
});

describe("依頼に載せる指針の文書", () => {
  it("辞書のあるベンダー_ベンダー共通・資格別の次に辞書の文書を足す", () => {
    expect(requestStyleGuides(repoRoot, "DBX-DEA-2605")).toEqual([
      "docs/exam-style/dbx-common.md",
      "docs/exam-style/dbx-dea.md",
      "docs/exam-style/dbx-terms.md",
    ]);
    expect(requestStyleGuides(repoRoot, "AWS-AIB-C01")?.at(-1)).toBe("docs/exam-style/aws-terms.md");
  });

  it("辞書の文書がない場合と帯のない資格_辞書を足さない、またはなし", () => {
    const root = mkdtempSync(join(tmpdir(), "terms-guides-"));
    expect(requestStyleGuides(root, "DBX-DEA-2605")).toEqual([
      "docs/exam-style/dbx-common.md",
      "docs/exam-style/dbx-dea.md",
    ]);
    mkdirSync(join(root, "docs/exam-style"), { recursive: true });
    writeFileSync(join(root, termsPath("DBX")), "# 辞書\n");
    expect(requestStyleGuides(root, "DBX-DEA-2605")?.at(-1)).toBe("docs/exam-style/dbx-terms.md");
    expect(requestStyleGuides(root, "EX-SMP-XX")).toBeNull();
  });
});

describe("リポジトリの辞書", () => {
  it("ベンダーの辞書_形が正しく読め_使う語と略語が重ならない", () => {
    for (const vendor of ["AWS", "DBX"]) {
      const t = readTerms(repoRoot, vendor);
      expect(t, vendor).not.toBeNull();
      for (const e of t?.entries ?? []) expect(e.avoid).not.toContain(e.use);
    }
    expect(readTerms(repoRoot, "NOPE")).toBeNull();
  });

  it("Databricks の辞書_公式の訳語の対を持つ", () => {
    const t = readTerms(repoRoot, "DBX");
    expect(t?.entries.find((e) => e.use === "テーブル")?.avoid).toContain("表");
    expect(findAvoidTerms("窓関数のスライディング窓です。", t as never)).toEqual(["窓"]);
    expect(findAvoidTerms("表形式のデータを表示します。", t as never)).toEqual([]);
  });
});
