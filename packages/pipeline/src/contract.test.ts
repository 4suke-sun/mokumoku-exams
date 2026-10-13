import { describe, expect, it } from "vitest";
import { ALLOWED_REFERENCE_HOSTS, QuestionsFileSchema, validateDataSet } from "./contract.ts";

describe("データの契約", () => {
  it("共有パッケージから許可ドメインとスキーマと検査を読める", () => {
    expect(ALLOWED_REFERENCE_HOSTS.length).toBeGreaterThan(0);
    expect(QuestionsFileSchema.safeParse({}).success).toBe(false);
    expect(typeof validateDataSet).toBe("function");
  });
});
