import { describe, expect, it } from "vitest";
import { buildFeedbackIssue, fence } from "./issue.ts";

describe("fence", () => {
  it("バッククォートを含まない内容_3 つの囲みで包む", () => {
    expect(fence("こんにちは")).toBe("```text\nこんにちは\n```");
  });

  it("内容にバッククォートの連続がある_それより長い囲みで包み_内容で閉じられない", () => {
    const text = "前\n````\n後 ``x``";
    const fenced = fence(text);
    expect(fenced.startsWith("`````text\n")).toBe(true);
    expect(fenced.endsWith("\n`````")).toBe(true);
  });
});

describe("buildFeedbackIssue", () => {
  it("お問い合わせの不具合_固定の題と_user と bug のラベルになる", () => {
    const issue = buildFeedbackIssue(
      { form: "contact", category: "bug", text: "  @someone #12 が動かない  " },
      "v0.84.0",
    );
    expect(issue.title).toBe("お問い合わせ: 不具合");
    expect(issue.labels).toEqual(["user", "bug"]);
    expect(issue.body).toContain("アプリの版: v0.84.0");
    expect(issue.body).toContain("```text\n@someone #12 が動かない\n```");
  });

  it("お問い合わせの種類ごと_決めたラベルになる", () => {
    const labels = (category: "bug" | "improvement" | "feature" | "other") =>
      buildFeedbackIssue({ form: "contact", category, text: "x" }, "v").labels;
    expect(labels("improvement")).toEqual(["user", "feat"]);
    expect(labels("feature")).toEqual(["user", "feat"]);
    expect(labels("other")).toEqual(["user"]);
  });

  it("利用者の入力_題に使われない", () => {
    const issue = buildFeedbackIssue({ form: "contact", category: "other", text: "題にしたい言葉" }, "v");
    expect(issue.title).not.toContain("題にしたい言葉");
  });

  it("試験についてのお問い合わせ_題と本文に資格コードを入れ_ラベルは種類のとおりになる", () => {
    const issue = buildFeedbackIssue(
      { form: "contact", category: "improvement", text: "見づらい", examCode: "EX-SMP-XX" },
      "v0.86.0",
    );
    expect(issue.title).toBe("お問い合わせ: 機能改善の要望(EX-SMP-XX)");
    expect(issue.body.split("\n").slice(0, 4)).toEqual([
      "フォーム: お問い合わせ",
      "種類: 機能改善の要望",
      "資格コード: EX-SMP-XX",
      "アプリの版: v0.86.0",
    ]);
    expect(issue.labels).toEqual(["user", "feat"]);
  });

  it("試験なしのお問い合わせ_題と本文に資格コードを入れない", () => {
    const issue = buildFeedbackIssue({ form: "contact", category: "other", text: "x" }, "v");
    expect(issue.title).toBe("お問い合わせ: その他");
    expect(issue.body).not.toContain("資格コード");
  });

  it("問題の誤りの報告_資格コードと問題 ID を題と本文に入れ_user と data のラベルになる", () => {
    const issue = buildFeedbackIssue(
      { form: "question", category: "answer", text: "", examCode: "EX-SMP-XX", questionId: "SAMPLE-0001" },
      "v0.84.0",
    );
    expect(issue.title).toBe("問題の誤り: EX-SMP-XX SAMPLE-0001(正解が違う)");
    expect(issue.labels).toEqual(["user", "data"]);
    expect(issue.body).toContain("資格コード: EX-SMP-XX");
    expect(issue.body).toContain("問題 ID: SAMPLE-0001");
    expect(issue.body).toContain("(なし)");
  });
});
