import { describe, expect, it } from "vitest";
import { checkGrounding, extractNumbers, extractTerms } from "./grounding.ts";
import { card, DOC_HASH, DOC_QUOTE, factsFixture } from "./test-helpers.ts";

const body = factsFixture("service-doc.html");
const source = { contentHash: DOC_HASH, status: "active" };
const base = card();
const evidence = base.sources[0] as (typeof base.sources)[number];

function check(overrides: { claim?: string; heading?: string; quote?: string; hash?: string } = {}) {
  return checkGrounding(
    overrides.claim ?? base.claim,
    {
      ...evidence,
      contentHash: overrides.hash ?? evidence.contentHash,
      anchor: { heading: overrides.heading ?? evidence.anchor.heading },
    },
    overrides.quote ?? DOC_QUOTE,
    source,
    body,
  );
}

describe("主張からの取り出し", () => {
  it("数値_全角を半角にし、桁区切りを落とす。サービス名の中の数字は数えない", () => {
    expect(extractNumbers("S3 は 3,500 件、EC2 は１００ 個、6.5 GB")).toEqual(["100", "3500", "6.5"]);
    expect(extractNumbers("1 つのアカウントに 2 つまで、上限は 10 個")).toEqual(["10"]);
  });

  it("固有名詞_大文字か数字を含むラテン文字の語だけ。小文字だけの語は数えない", () => {
    expect(extractTerms("Widget Store の bucket は S3 互換 (not Vault.)")).toEqual(["s3", "store", "vault", "widget"]);
  });
});

describe("根拠と本文の照合", () => {
  it("本文の通りの主張_通る", () => {
    expect(check()).toEqual([]);
  });

  it("下の深さの見出しの内容も、上の節の範囲で確かめられる", () => {
    expect(check({ claim: "Widget Store は、プレフィックスごとに毎秒 3,500 件の書き込みを受け付ける。" })).toEqual([]);
  });

  it("本文にない数値_number-mismatch", () => {
    expect(check({ claim: "Widget Store では、バケットは 200 個まで。" })).toEqual(["number-mismatch"]);
  });

  it("本文にない固有名詞_term-not-found", () => {
    expect(check({ claim: "Gadget Store では、バケットは 100 個まで。" })).toEqual(["term-not-found"]);
  });

  it("範囲の外にある数値_その節にないので不一致", () => {
    // 100 は quotas の節にあるが、security の節にはない
    expect(check({ heading: "security", quote: "enabled by default" })).toContain("number-mismatch");
  });

  it("見出しが本文にない・引用が節にない_理由コードで返す", () => {
    expect(check({ heading: "no-such-heading" })).toEqual(["anchor-not-found"]);
    expect(check({ quote: "a phrase that is not there" })).toEqual(["quote-not-found"]);
  });

  it("本文のハッシュが台帳の最新と違う・出典が active でない・本文がない_理由コードで返す", () => {
    expect(check({ hash: "f".repeat(64) })).toEqual(["hash-mismatch"]);
    expect(checkGrounding(base.claim, evidence, DOC_QUOTE, { ...source, status: "needs-review" }, body)).toEqual([
      "source-not-active",
    ]);
    expect(checkGrounding(base.claim, evidence, DOC_QUOTE, undefined, body)).toEqual(["source-not-active"]);
    expect(checkGrounding(base.claim, evidence, DOC_QUOTE, source, null)).toEqual(["body-not-cached"]);
  });

  it("結果_理由コードだけで、本文を含まない", () => {
    const reasons = check({ claim: "Gadget Store では、バケットは 200 個まで。" });
    expect(JSON.stringify(reasons)).not.toContain("buckets per account");
    expect(reasons).toEqual(["number-mismatch", "term-not-found"]);
  });
});
