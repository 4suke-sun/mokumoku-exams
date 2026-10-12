import { describe, expect, it } from "vitest";
import { HELP_TEXT } from "./help.ts";

describe("ヘルプ", () => {
  it("使い方の行を含む", () => {
    expect(HELP_TEXT).toContain("npm run pipeline -- <コマンド>");
  });
});
