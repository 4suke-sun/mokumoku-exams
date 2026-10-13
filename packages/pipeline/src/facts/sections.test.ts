import { describe, expect, it } from "vitest";
import { findSection, parseSections } from "./sections.ts";
import { factsFixture } from "./test-helpers.ts";

const html = factsFixture("service-doc.html");

describe("節への分割", () => {
  it("見出しごとに分け、同じか上の深さの見出しの直前までを節の本文にする", () => {
    const sections = parseSections(html);
    expect(sections.map((s) => [s.id, s.level])).toEqual([
      ["top", 1],
      ["quotas", 2],
      ["quotas-rate", 3],
      ["security", 2],
    ]);
    const quotas = sections.find((s) => s.id === "quotas");
    expect(quotas?.text).toContain("up to 100 buckets per account");
    // 下の深さの見出しの節は、上の節に含まれる
    expect(quotas?.text).toContain("3,500 write requests");
    expect(quotas?.text).not.toContain("encryption at rest");
    expect(sections.find((s) => s.id === "quotas-rate")?.text).not.toContain("100 buckets");
  });

  it("見出しの ID または見出しの文で、節を探す", () => {
    expect(findSection(html, "security")?.title).toBe("security");
    expect(findSection(html, "Quotas and limits")?.id).toBe("quotas");
    expect(findSection(html, "quotas and  LIMITS")?.id).toBe("quotas");
    expect(findSection(html, "no-such-heading")).toBeNull();
  });

  it("見出しの中のアンカー要素の ID も読む", () => {
    const sections = parseSections('<h2><a id="inner-id"></a>Title</h2><p>body</p>');
    expect(sections[0]?.id).toBe("inner-id");
  });
});
