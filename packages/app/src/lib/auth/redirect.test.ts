import { describe, expect, it } from "vitest";
import { safeNext } from "./redirect.ts";

describe("safeNext", () => {
  it.each(["/exams", "/exams/EX-SMP-XX/play", "/exams/EX-SMP-XX?mode=all", "/help#top"])(
    "このサイト内の画面_%s はそのまま使う",
    (value) => {
      expect(safeNext(value)).toBe(value);
    },
  );

  it.each([
    ["未指定", undefined],
    ["空", ""],
    ["別のサイト(スキーム付き)", "https://example.com/"],
    ["別のサイト(スキームなし)", "//example.com/"],
    ["別のサイト(バックスラッシュ)", "/\\example.com"],
    ["相対パス", "exams"],
    ["改行を含む", "/exams\r\nSet-Cookie: a=b"],
    ["制御文字を含む", "/exams\u0000"],
    ["長すぎる", `/${"a".repeat(600)}`],
    ["ログイン画面", "/login?next=%2Fexams"],
    ["再設定の画面", "/forgot-password"],
    ["API", "/api/history/results"],
  ])("%s_トップに戻す", (_name, value) => {
    expect(safeNext(value)).toBe("/");
  });
});
