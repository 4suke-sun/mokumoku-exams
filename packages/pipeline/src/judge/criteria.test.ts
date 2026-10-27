import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { extractCriteria, readCriteria, withScope } from "./criteria.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");

describe("判定の基準の取り出し", () => {
  it("節がある文書_見出しから次の ## の手前までを取り出す", () => {
    const doc =
      "# 題\n\n## 5. 範囲\n\n本文。\n\n## 6. 判定の基準\n\n基準の本文。\n\n### 機械の観点\n\n点数票。\n\n## 7. 次\n\n別の節。\n";
    const text = extractCriteria(doc);
    expect(text).toContain("## 6. 判定の基準");
    expect(text).toContain("### 機械の観点");
    expect(text).not.toContain("別の節");
    expect(text).not.toContain("本文。\n\n## 6.");
  });

  it("節が文書の終わりまで続く_最後まで取り出す。改行コードが CRLF でも同じ", () => {
    const lf = "## 判定の基準\n\n末尾の節。\n";
    expect(extractCriteria(lf)).toBe("## 判定の基準\n\n末尾の節。");
    expect(extractCriteria(lf.replace(/\n/g, "\r\n"))).toBe("## 判定の基準\n\n末尾の節。");
  });

  it("節がない文書_null", () => {
    expect(extractCriteria("# 題\n\n## 1. 要点\n\n本文\n")).toBeNull();
  });

  it("本文中の『判定の基準』という語_見出しでなければ節として扱わない", () => {
    expect(extractCriteria("## 1. 要点\n\n判定の基準は別の文書にあります。\n")).toBeNull();
  });
});

describe("資格の判定の基準", () => {
  it.each(["AWS-CLF-C02", "AWS-DVA-C02", "AWS-AIB-C01"])(
    "%s_資格別の文書に節があり_ハッシュが 64 桁で決まる",
    (code) => {
      const a = readCriteria(repoRoot, code);
      const b = readCriteria(repoRoot, code);
      expect(a).not.toBeNull();
      expect(a?.hash).toMatch(/^[0-9a-f]{64}$/);
      expect(b?.hash).toBe(a?.hash);
      expect(a?.path).toMatch(/^docs\/exam-style\/aws-[a-z]+\.md$/);
    },
  );

  it("帯のない資格・文書がない資格_null", () => {
    expect(readCriteria(repoRoot, "EX-SMP-XX")).toBeNull();
    expect(readCriteria("/nonexistent-root-for-test", "AWS-CLF-C02")).toBeNull();
  });
});

describe("判定の基準への範囲の一覧", () => {
  const base = readCriteria(repoRoot, "AWS-AIB-C01");

  it("一覧がある_基準の末尾に対象と対象外を足し_ハッシュは一覧を含む", () => {
    if (base === null) throw new Error("基準がない");
    const a = withScope(base, { inScope: ["AWS Lambda"], outOfScope: ["Amazon Kinesis"] });
    expect(a.text.startsWith(base.text)).toBe(true);
    expect(a.text).toContain("対象のサービス: AWS Lambda");
    expect(a.text).toContain("対象外のサービス: Amazon Kinesis");
    expect(a.hash).not.toBe(base.hash);
    const b = withScope(base, { inScope: ["AWS Lambda"], outOfScope: ["Amazon Kinesis", "Amazon SageMaker"] });
    expect(b.hash).not.toBe(a.hash);
  });

  it("対象外の一覧だけがある_対象の行を足さない", () => {
    if (base === null) throw new Error("基準がない");
    const a = withScope(base, { inScope: [], outOfScope: ["Amazon Kinesis"] });
    expect(a.text).not.toContain("対象のサービス:");
    expect(a.text).toContain("対象外のサービス: Amazon Kinesis");
  });

  it("一覧がない_基準をそのまま返す", () => {
    if (base === null) throw new Error("基準がない");
    expect(withScope(base, { inScope: [], outOfScope: [] })).toBe(base);
  });
});
