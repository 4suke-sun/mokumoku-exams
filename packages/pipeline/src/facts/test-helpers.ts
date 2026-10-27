import { readFileSync } from "node:fs";
import { join } from "node:path";
import { contentHashOf } from "../collect/content-hash.ts";
import type { FactCard } from "./schema.ts";

export function factsFixture(name: string): string {
  return readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
}

export const DOC_URL = "https://docs.aws.amazon.com/guide/service.html";
/** card() の根拠が、本文の中で照合される引用(台帳には残さない。照合のときだけ渡す) */
export const DOC_QUOTE = "up to 100 buckets per account";
export const DOC_HASH = contentHashOf(Buffer.from(factsFixture("service-doc.html")));

/** 事実カード(テスト用の既定値。fixture の本文に合う、通る内容) */
export function card(overrides: Partial<FactCard> = {}): FactCard {
  return {
    id: "f-000000000001",
    claim: "Widget Store では、1 つのアカウントがリージョンごとに持てるバケットは 100 個まで。",
    sources: [
      {
        url: DOC_URL,
        section: "Quotas and limits",
        anchor: { heading: "quotas" },
        contentHash: DOC_HASH,
      },
    ],
    scope: { edition: "C01" },
    confidence: "high",
    domain: "domain1",
    scopeItems: [],
    status: "passed",
    reasons: [],
    ...overrides,
  };
}
