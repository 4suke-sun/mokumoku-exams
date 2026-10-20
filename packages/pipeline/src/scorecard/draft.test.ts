import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { DraftRequestSchema } from "../draft/request.ts";
import { choiceDraft } from "../draft/test-helpers.ts";
import { scorecardWarnings } from "./draft.ts";
import { styleGuidePaths } from "./profiles.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");

/** 点数票の帯のある資格(Cloud Practitioner)の帯に合う、架空の下書き */
const GOOD = choiceDraft({
  questionText:
    "ある企業は、Widget Store に保存した画像を長期間、低いコストで保管したいと考えています。この要件を満たすサービスはどれでしょうか。",
  choices: [
    { key: "A", text: "Widget Archive" },
    { key: "B", text: "Widget Block" },
    { key: "C", text: "Widget Compute" },
    { key: "D", text: "Widget Queue" },
  ],
  correctAnswers: ["A"],
});

describe("下書きの取り込みでの点数票の警告", () => {
  it("帯のある資格で帯に合う下書き_警告を返さない", () => {
    expect(scorecardWarnings(GOOD, "AWS-CLF-C02")).toEqual([]);
  });

  it("帯のある資格で帯に合わない下書き_減点された項目を規則名と場所で返す", () => {
    const bad = choiceDraft({ questionText: "バケットの上限はどれか。" });
    const warnings = scorecardWarnings(bad, "AWS-CLF-C02");
    expect(warnings).toContainEqual({ rule: "scorecard-a1", path: "questionText" });
    expect(warnings).toContainEqual({ rule: "scorecard-b6", path: "questionText" });
    expect(warnings.every((w) => /^scorecard-[ab][0-9]+$/.test(w.rule))).toBe(true);
  });

  it("警告_設問文や選択肢の本文を含まない", () => {
    const text = JSON.stringify(
      scorecardWarnings(choiceDraft({ questionText: "バケットの上限はどれか。" }), "AWS-CLF-C02"),
    );
    expect(text).not.toContain("バケット");
  });

  it("同じ下書きを別の資格の帯で採点_長さの帯が違うので警告が増える", () => {
    expect(scorecardWarnings(GOOD, "AWS-CLF-C02")).toEqual([]);
    expect(scorecardWarnings(GOOD, "AWS-DVA-C02").length).toBeGreaterThan(0);
  });

  it("点数票の帯のない資格_警告を返さない", () => {
    expect(scorecardWarnings(choiceDraft({ questionText: "バケットの上限はどれか。" }), "AWS-AIB-C01")).toEqual([]);
  });
});

describe("出題スタイルの指針の文書", () => {
  it("依頼の形_指針の文書は docs/exam-style の下の md だけを受け付ける", () => {
    const ok = DraftRequestSchema.shape.styleGuides;
    expect(ok.safeParse(["docs/exam-style/aws-common.md"]).success).toBe(true);
    for (const bad of [["../secret.md"], ["docs/question-style.md"], ["/etc/passwd"], ["docs/exam-style/../x.md"]]) {
      expect(ok.safeParse(bad).success, bad[0]).toBe(false);
    }
  });

  it("帯のある資格_ベンダー共通と資格別の文書のパスを返し_どちらも実在する", () => {
    expect(styleGuidePaths("AWS-CLF-C02")).toEqual(["docs/exam-style/aws-common.md", "docs/exam-style/aws-clf.md"]);
    expect(styleGuidePaths("AWS-DVA-C02")).toEqual(["docs/exam-style/aws-common.md", "docs/exam-style/aws-dva.md"]);
    for (const path of [...(styleGuidePaths("AWS-CLF-C02") ?? []), ...(styleGuidePaths("AWS-DVA-C02") ?? [])]) {
      expect(existsSync(resolve(repoRoot, path)), path).toBe(true);
    }
  });

  it("帯のない資格_null を返す", () => {
    expect(styleGuidePaths("AWS-AIB-C01")).toBeNull();
  });
});
