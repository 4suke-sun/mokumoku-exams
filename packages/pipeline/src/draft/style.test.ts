import { describe, expect, it } from "vitest";
import type { Draft, FreeTextDraft } from "./schema.ts";
import { checkStyle, evaluateStyle, STYLE_RULES } from "./style.ts";
import { choiceDraft, freeTextDraft, multipleDraft } from "./test-helpers.ts";

function findings(draft: Draft, rule: string) {
  return checkStyle(draft).filter((f) => f.rule === rule);
}

describe("スタイル規則", () => {
  it("規則に違反しない下書き_指摘が出ない", () => {
    expect(checkStyle(choiceDraft())).toEqual([]);
    expect(checkStyle(multipleDraft())).toEqual([]);
  });

  it("規則の一覧_名前が重複しない", () => {
    const names = STYLE_RULES.map((r) => r.name);
    expect(new Set(names).size).toBe(names.length);
  });

  describe("stem-question-form", () => {
    it("問いの形で終わる_通る", () => {
      for (const stem of ["上限はどれですか。", "上限を選択してください。", "上限はどれか?", "上限を選びなさい"]) {
        expect(findings(choiceDraft({ questionText: stem }), "stem-question-form")).toEqual([]);
      }
    });

    it("問いの形で終わらない_止める", () => {
      const f = findings(choiceDraft({ questionText: "バケットの上限は 100 個です。" }), "stem-question-form");
      expect(f).toEqual([{ rule: "stem-question-form", severity: "block", path: "questionText" }]);
    });
  });

  describe("multi-select-count", () => {
    it("選ぶ数が書かれている_通る", () => {
      expect(findings(multipleDraft(), "multi-select-count")).toEqual([]);
      expect(
        findings(multipleDraft({ questionText: "正しいものを二つ選んでください。" }), "multi-select-count"),
      ).toEqual([]);
    });

    it("複数選択で選ぶ数がない_止める", () => {
      const f = findings(multipleDraft({ questionText: "正しい説明を選択してください。" }), "multi-select-count");
      expect(f).toHaveLength(1);
      expect(f[0]?.severity).toBe("block");
    });

    it("単一選択では_数がなくても通る", () => {
      expect(findings(choiceDraft(), "multi-select-count")).toEqual([]);
    });

    it("書いた数と正答の数が違う_止める", () => {
      const f = findings(
        multipleDraft({ questionText: "正しい説明を 3 つ選択してください。" }),
        "multi-select-count-mismatch",
      );
      expect(f).toHaveLength(1);
      expect(findings(multipleDraft(), "multi-select-count-mismatch")).toEqual([]);
    });
  });

  describe("否定", () => {
    it("否定を 1 つ含む_警告する", () => {
      const f = findings(choiceDraft({ questionText: "次のうち、誤っているものはどれですか。" }), "stem-negation");
      expect(f).toEqual([{ rule: "stem-negation", severity: "warn", path: "questionText" }]);
    });

    it("否定がない_指摘が出ない", () => {
      expect(findings(choiceDraft(), "stem-negation")).toEqual([]);
    });

    it("否定を 2 つ含む_止める", () => {
      const q = "次のうち、誤っているとは言えないものを除き、適切ではないものはどれですか。";
      expect(findings(choiceDraft({ questionText: q }), "stem-double-negation")).toHaveLength(1);
    });

    it("何度呼んでも_同じ結果になる(状態を持たない)", () => {
      const d = choiceDraft({ questionText: "次のうち、誤っているものはどれですか。" });
      expect(findings(d, "stem-negation")).toHaveLength(1);
      expect(findings(d, "stem-negation")).toHaveLength(1);
    });
  });

  describe("選択肢", () => {
    it("選択肢が 3 つ_警告する", () => {
      const d = choiceDraft({
        choices: [
          { key: "A", text: "10 個" },
          { key: "B", text: "100 個" },
          { key: "C", text: "1,000 個" },
        ],
      });
      expect(findings(d, "choice-count")).toHaveLength(1);
      expect(findings(choiceDraft(), "choice-count")).toEqual([]);
    });

    it("長さが大きく違う_警告する", () => {
      const long = "バケットの名前は、リージョンの中で一意であり、作成の後に変更することはできない".repeat(1);
      const d = choiceDraft({
        choices: [
          { key: "A", text: "10 個" },
          { key: "B", text: long },
          { key: "C", text: "1,000 個" },
          { key: "D", text: "上限はない" },
        ],
      });
      expect(findings(d, "choice-length-balance")).toHaveLength(1);
      expect(findings(choiceDraft(), "choice-length-balance")).toEqual([]);
    });

    it("正答だけが長い_警告し_そろっていれば通る", () => {
      const d = choiceDraft({
        choices: [
          { key: "A", text: "リージョンごとに数える上限" },
          { key: "B", text: "リージョンごとに数え、アカウントの上限として定められている数" },
          { key: "C", text: "ゾーンごとに数える上限" },
          { key: "D", text: "区画ごとに数える上限" },
        ],
      });
      expect(findings(d, "correct-length-bias")).toHaveLength(1);
      expect(findings(choiceDraft(), "correct-length-bias")).toEqual([]);
    });

    it("ほぼ同じ文言の選択肢_警告する", () => {
      const d = choiceDraft({
        choices: [
          { key: "A", text: "リージョンごとに 100 個まで作れる" },
          { key: "B", text: "リージョンごとに 100 個まで作れます" },
          { key: "C", text: "ゾーンごとに 10 個まで" },
          { key: "D", text: "上限はない" },
        ],
      });
      const f = findings(d, "choice-similar-pair");
      expect(f).toEqual([{ rule: "choice-similar-pair", severity: "warn", path: "choices.1.text" }]);
    });

    it("まとめる選択肢_止める", () => {
      for (const text of ["上記のすべて", "いずれでもない", "すべて正しい", "None of the above"]) {
        const d = choiceDraft({
          choices: [
            { key: "A", text: "10 個" },
            { key: "B", text: "100 個" },
            { key: "C", text: "1,000 個" },
            { key: "D", text },
          ],
        });
        expect(findings(d, "choice-catch-all")).toEqual([
          { rule: "choice-catch-all", severity: "block", path: "choices.3.text" },
        ]);
      }
      expect(findings(choiceDraft(), "choice-catch-all")).toEqual([]);
    });
  });

  describe("禁止事項", () => {
    it("断定しすぎる語_警告し_場所だけを報告する", () => {
      const d = choiceDraft({
        choices: [
          { key: "A", text: "必ず 10 個になる" },
          { key: "B", text: "100 個" },
          { key: "C", text: "1,000 個" },
          { key: "D", text: "上限はない" },
        ],
      });
      expect(findings(d, "overclaim-term")).toEqual([
        { rule: "overclaim-term", severity: "warn", path: "choices.0.text" },
      ]);
      expect(findings(choiceDraft(), "overclaim-term")).toEqual([]);
    });

    it("URL_設問文・選択肢・解説のどこでも止める", () => {
      const d = choiceDraft({
        questionText: "https://example.com/doc を読んで、上限はどれですか。",
        explanation: "詳しくは www.example.com を参照してください。上限は 100 個と定められています。",
      });
      const paths = findings(d, "no-url").map((f) => f.path);
      expect(paths).toEqual(["questionText", "explanation"]);
      expect(findings(choiceDraft(), "no-url")).toEqual([]);
    });

    it("環境固有の値_止める", () => {
      const cases = [
        `アカウント ${"1234".repeat(3)} のバケットの上限はどれですか。`,
        "arn:aws:s3:::example の上限はどれですか。",
        `${"AKI" + "A"}${"ABCDEFGH" + "IJKLMNOP"} の上限はどれですか。`,
        "user@example.com の上限はどれですか。",
        `${"/Us" + "ers"}/name/work の上限はどれですか。`,
      ];
      for (const q of cases) {
        expect(findings(choiceDraft({ questionText: q }), "no-env-value")).toHaveLength(1);
      }
      expect(findings(choiceDraft({ questionText: "CIDR 10.0.0.0/16 の上限はどれですか。" }), "no-env-value")).toEqual(
        [],
      );
    });

    it("総合解説が短い_警告する", () => {
      expect(findings(choiceDraft({ explanation: "100 個です。" }), "explanation-length")).toHaveLength(1);
      expect(findings(choiceDraft(), "explanation-length")).toEqual([]);
    });
  });

  const rulesOf = (d: Draft) => checkStyle(d).map((f) => `${f.rule} ${f.path}`);

  it("解説の見出し_表の名前とその別名は通り、表にない名前は止める", () => {
    const ok = choiceDraft({
      explanation: "## 正解の決め手\nバケットは 100 個までです。\n\n## 他の選択肢が誤りの理由\nほかは数値が違います。",
    });
    expect(rulesOf(ok).filter((r) => r.startsWith("explanation-heading"))).toEqual([]);
    const bad = choiceDraft({ explanation: "## 答えのポイント\nバケットは 100 個までと定められています。" });
    expect(rulesOf(bad)).toContain("explanation-heading explanation");
  });

  it("誤りの理由の節_選択肢ごとの組なら通り、組にならない段落があれば止める", () => {
    const head = "バケットは 100 個までです。\n\n## 他の選択肢が誤りである理由\n\n";
    const wrongPairs = (d: Draft) => rulesOf(d).filter((r) => r.startsWith("explanation-wrong-pairs"));
    // 選択肢の本文は、空白と読点・句点を除いて比べる
    const ok = choiceDraft({ explanation: `${head}10個。\n\n小さすぎる誤りです。\n\n上限は ない\n\n上限はあります。` });
    expect(wrongPairs(ok)).toEqual([]);
    // 節がない解説は対象外
    expect(wrongPairs(choiceDraft())).toEqual([]);
    const intro = choiceDraft({ explanation: `${head}次のとおりです。\n\n10 個\n\n小さすぎる誤りです。` });
    expect(wrongPairs(intro)).toEqual(["explanation-wrong-pairs explanation"]);
    const noReason = choiceDraft({ explanation: `${head}10 個\n\n1,000 個\n\n大きすぎる誤りです。` });
    expect(wrongPairs(noReason)).toEqual(["explanation-wrong-pairs explanation"]);
    // 自由記述には選択肢がないので、対象外
    expect(rulesOf(freeTextDraft({ explanation: `${head}補足です。` })).join(" ")).not.toContain(
      "explanation-wrong-pairs",
    );
  });

  it("解説の記号_問題の記号は通り、存在しない記号と単独の大文字は止める", () => {
    const ok = choiceDraft({
      explanation: "正解は B です。A は小さすぎ、C は大きすぎます。AWS の上限とは別の話で、X-Ray とも関係しません。",
    });
    expect(rulesOf(ok).filter((r) => r.startsWith("explanation-key-reference"))).toEqual([]);
    const bad = choiceDraft({ explanation: "正解は E です。上限は 100 個と定められています。" });
    expect(rulesOf(bad)).toContain("explanation-key-reference explanation");
    const badReason = choiceDraft({
      distractors: choiceDraft().distractors?.map((d, i) =>
        i === 0 ? { ...d, reason: "選択肢 X と混同した誤りです" } : d,
      ),
    });
    expect(rulesOf(badReason)).toContain("explanation-key-reference distractors.0.reason");
  });

  it("誤答の選択肢の解説_誤答の理由か選択肢の解説があれば通り、どちらもなければ止める", () => {
    expect(rulesOf(choiceDraft()).filter((r) => r.startsWith("choice-explanation-missing"))).toEqual([]);
    const withChoiceText = choiceDraft({
      distractors: undefined,
      choices: choiceDraft().choices.map((c) => ({ ...c, explanation: `${c.text} についての説明です` })),
    });
    expect(rulesOf(withChoiceText).filter((r) => r.startsWith("choice-explanation-missing"))).toEqual([]);
    const none = choiceDraft({ distractors: undefined });
    expect(rulesOf(none)).toEqual(
      expect.arrayContaining([
        "choice-explanation-missing choices.0.explanation",
        "choice-explanation-missing choices.2.explanation",
        "choice-explanation-missing choices.3.explanation",
      ]),
    );
  });

  it("選択肢ごとの解説の記法_太字とコードは通り、見出しと箇条書きは止める", () => {
    const ok = choiceDraft({
      distractors: choiceDraft().distractors?.map((d) => ({
        ...d,
        reason: `**${d.reason}**。\`limit\` を見落としています`,
      })),
    });
    expect(rulesOf(ok).filter((r) => r.startsWith("choice-explanation-markup"))).toEqual([]);
    const bad = choiceDraft({
      choices: choiceDraft().choices.map((c, i) => (i === 0 ? { ...c, explanation: "- 数値が違う\n- 上限は 100" } : c)),
    });
    expect(rulesOf(bad)).toContain("choice-explanation-markup choices.0.explanation");
    // 字下げした見出しは止め、記号だけの行(空白が続かない)は止めない
    const indented = choiceDraft({
      choices: choiceDraft().choices.map((c, i) => (i === 0 ? { ...c, explanation: "  ### 補足\n数値が違う" } : c)),
    });
    expect(rulesOf(indented)).toContain("choice-explanation-markup choices.0.explanation");
    const bare = choiceDraft({
      choices: choiceDraft().choices.map((c, i) => (i === 0 ? { ...c, explanation: "数値が違う\n-\n上限は 100" } : c)),
    });
    expect(rulesOf(bare).filter((r) => r.startsWith("choice-explanation-markup"))).toEqual([]);
  });

  it("違反の報告_本文が含まれない", () => {
    const d = choiceDraft({ questionText: "秘密めいた本文 https://example.com が URL を含む。" });
    const serialized = JSON.stringify(checkStyle(d));
    expect(serialized).not.toContain("秘密めいた本文");
    expect(serialized).not.toContain("example.com");
  });

  describe("evaluateStyle", () => {
    it("止める規則に違反する下書き_blockers に入り_warnings には入らない", () => {
      const d = choiceDraft({ questionText: "バケットの上限は 100 個です。" });
      const v = evaluateStyle(d);
      expect(v.blockers.map((f) => f.rule)).toEqual(["stem-question-form"]);
      expect(v.warnings).toEqual([]);
    });

    it("警告の規則だけに違反する下書き_warnings に入り_blockers は空", () => {
      const v = evaluateStyle(choiceDraft({ questionText: "次のうち、誤っているものはどれですか。" }));
      expect(v.blockers).toEqual([]);
      expect(v.warnings.map((f) => f.rule)).toEqual(["stem-negation"]);
    });

    it("違反がない_どちらも空", () => {
      expect(evaluateStyle(choiceDraft())).toEqual({ blockers: [], warnings: [] });
    });
  });

  describe("自由記述", () => {
    const rubric = (criteria: FreeTextDraft["rubric"]["criteria"], passingPoints = 60): FreeTextDraft["rubric"] => ({
      criteria,
      passingPoints,
    });

    it("規則に違反しない自由記述_指摘が出ない", () => {
      expect(checkStyle(freeTextDraft())).toEqual([]);
    });

    it("選択式の規則は自由記述に適用しない_選択肢の規則が出ない", () => {
      const names = new Set(checkStyle(freeTextDraft({ questionText: "上限は 100 個です。" })).map((f) => f.rule));
      expect(names).toEqual(new Set(["stem-question-form"]));
    });

    it("選択式の下書き_自由記述の規則を適用しない", () => {
      const names = checkStyle(choiceDraft()).map((f) => f.rule);
      expect(names.some((n) => n.startsWith("rubric-"))).toBe(false);
    });

    it("設問文が問いの形で終わらない_止める", () => {
      expect(findings(freeTextDraft({ questionText: "上限について述べる。" }), "stem-question-form")).toHaveLength(1);
    });

    it("観点が 1 つだけ_警告する", () => {
      const d = freeTextDraft({ rubric: rubric([{ name: "上限", keywords: ["上限"], points: 100 }], 60) });
      expect(findings(d, "rubric-criteria-count")).toEqual([
        { rule: "rubric-criteria-count", severity: "warn", path: "rubric.criteria" },
      ]);
    });

    it("1 文字のキーワード_警告する", () => {
      const d = freeTextDraft({
        rubric: rubric([
          { name: "上限", keywords: ["上限", "数"], points: 50 },
          { name: "対処", keywords: ["申請"], points: 50 },
        ]),
      });
      expect(findings(d, "rubric-keyword-short")).toEqual([
        { rule: "rubric-keyword-short", severity: "warn", path: "rubric.criteria.0.keywords.1" },
      ]);
    });

    it("同じキーワードが複数の観点にある_警告する", () => {
      const d = freeTextDraft({
        rubric: rubric([
          { name: "上限", keywords: ["上限", "申請"], points: 50 },
          { name: "対処", keywords: ["申請"], points: 50 },
        ]),
      });
      expect(findings(d, "rubric-keyword-shared")).toEqual([
        { rule: "rubric-keyword-shared", severity: "warn", path: "rubric.criteria.1.keywords.0" },
      ]);
    });

    it("合格点の割合が偏る_警告する", () => {
      expect(
        findings(freeTextDraft({ rubric: { ...freeTextDraft().rubric, passingPoints: 30 } }), "rubric-pass-ratio"),
      ).toHaveLength(1);
      expect(
        findings(freeTextDraft({ rubric: { ...freeTextDraft().rubric, passingPoints: 100 } }), "rubric-pass-ratio"),
      ).toHaveLength(1);
    });

    it("観点名やキーワードに URL がある_止め_場所を報告する", () => {
      const d = freeTextDraft({
        rubric: rubric([
          { name: "上限", keywords: ["https://example.com/x"], points: 50 },
          { name: "対処", keywords: ["申請"], points: 50 },
        ]),
      });
      expect(findings(d, "no-url")).toEqual([
        { rule: "no-url", severity: "block", path: "rubric.criteria.0.keywords.0" },
      ]);
    });
  });
});
