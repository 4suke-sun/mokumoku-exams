import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchReviewItems } from "./client.ts";
import { RESULTS_PAGE_SIZE } from "./limits.ts";
import { RESULTS_PAGE_SIZE as SERVER_PAGE_SIZE } from "./repository.ts";
import { ListQuerySchema } from "./schema.ts";

afterEach(() => vi.unstubAllGlobals());

function stubReview(examCode: string) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ items: [{ examCode, questionId: "AIB-0001", streak: 0, mastered: false }] })),
  );
}

describe("復習の項目の受け取り", () => {
  it("契約が許す最大の長さ(22 文字)の試験コード_項目を読める", async () => {
    const longest = `${"A".repeat(6)}-${"B".repeat(10)}-${"C".repeat(4)}`;
    stubReview(longest);
    expect(await fetchReviewItems()).toHaveLength(1);
  });

  it("契約の形でない試験コード_読めない", async () => {
    stubReview("aws-aib-c01");
    expect(await fetchReviewItems()).toBeNull();
  });
});

describe("契約と件数の定義の共有", () => {
  it("サーバーの検査_契約が許す最大の長さの試験コードを通す", () => {
    const longest = `${"A".repeat(6)}-${"B".repeat(10)}-${"C".repeat(4)}`;
    expect(ListQuerySchema.safeParse({ examCode: longest }).success).toBe(true);
    expect(ListQuerySchema.safeParse({ examCode: `${longest}X` }).success).toBe(false);
  });

  it("結果の一覧の上限_サーバーが 1 回に返す件数と同じ定義", () => {
    expect(SERVER_PAGE_SIZE).toBe(RESULTS_PAGE_SIZE);
  });
});
