import { describe, expect, it } from "vitest";
import { checkDistractors } from "./distractors.ts";
import type { ChoiceDraft, Distractor } from "./schema.ts";
import { choiceDraft, multipleDraft } from "./test-helpers.ts";

const FACT = "f-aaaaaaaaaaaa";
const context = {
  factIds: new Set([FACT]),
  claims: ["Widget Store では、1 つのアカウントがリージョンごとに持てるバケットは 100 個まで。"],
};
const check = (draft: ChoiceDraft) => checkDistractors(draft, context);
const entry = (overrides: Partial<Distractor>): Distractor => ({
  key: "A",
  type: "misconception",
  reason: "根拠を取り違えた誤りです",
  basis: { factId: FACT },
  ...overrides,
});

describe("checkDistractors", () => {
  it("誤答ごとに理由と根拠がある_指摘が出ない", () => {
    expect(check(choiceDraft())).toEqual({ blockers: [], warnings: [], ambiguous: [] });
    expect(check(multipleDraft())).toEqual({ blockers: [], warnings: [], ambiguous: [] });
  });

  it("誤りの理由と根拠のない誤答_止める", () => {
    const d = choiceDraft({ distractors: choiceDraft().distractors?.filter((x) => x.key !== "C") });
    expect(check(d).blockers).toEqual([{ code: "distractor-missing", path: "choices.2" }]);
    expect(check(choiceDraft({ distractors: undefined })).blockers.map((b) => b.code)).toEqual([
      "distractor-missing",
      "distractor-missing",
      "distractor-missing",
    ]);
  });

  it("理由が短い_止める", () => {
    const d = choiceDraft({
      distractors: [entry({ key: "A", reason: "誤り" }), ...(choiceDraft().distractors ?? []).slice(1)],
    });
    expect(check(d).blockers).toEqual([{ code: "distractor-reason-short", path: "distractors.0" }]);
  });

  it("正答の選択肢や存在しない選択肢への設計_止める", () => {
    const base = choiceDraft().distractors ?? [];
    expect(check(choiceDraft({ distractors: [...base, entry({ key: "B" })] })).blockers).toEqual([
      { code: "distractor-unknown-key", path: "distractors.3" },
    ]);
    expect(check(choiceDraft({ distractors: [...base, entry({ key: "Z" })] })).blockers).toEqual([
      { code: "distractor-unknown-key", path: "distractors.3" },
    ]);
  });

  it("同じ選択肢への設計が重複する_止める", () => {
    const base = choiceDraft().distractors ?? [];
    const d = choiceDraft({ distractors: [...base, entry({ key: "A" })] });
    expect(check(d).blockers).toEqual([{ code: "distractor-duplicate", path: "distractors.3" }]);
  });

  it("依頼にない事実カードを根拠にする_止める", () => {
    const base = choiceDraft().distractors ?? [];
    const d = choiceDraft({
      distractors: [entry({ key: "A", basis: { factId: "f-ffffffffffff" } }), ...base.slice(1)],
    });
    expect(check(d).blockers).toEqual([{ code: "distractor-basis-not-in-request", path: "distractors.0" }]);
  });

  it("適用範囲の違いを根拠にできるのは_scope-difference の型だけ", () => {
    const base = choiceDraft().distractors ?? [];
    const ok = choiceDraft({
      distractors: [
        entry({ key: "A", type: "scope-difference", basis: { scope: "別のリージョンの上限" } }),
        ...base.slice(1),
      ],
    });
    expect(check(ok).blockers).toEqual([]);
    const bad = choiceDraft({
      distractors: [
        entry({ key: "A", type: "misconception", basis: { scope: "別のリージョンの上限" } }),
        ...base.slice(1),
      ],
    });
    expect(check(bad).blockers).toEqual([{ code: "distractor-basis-scope-type", path: "distractors.0" }]);
  });

  it("理由や適用範囲の言い表しに URL や環境固有の値がある_止める", () => {
    const base = choiceDraft().distractors ?? [];
    const withUrl = choiceDraft({
      distractors: [
        entry({ key: "A", reason: "https://example.com/doc に書かれた上限と違う誤りです" }),
        ...base.slice(1),
      ],
    });
    expect(check(withUrl).blockers).toEqual([{ code: "distractor-forbidden-text", path: "distractors.0" }]);
    const withEnv = choiceDraft({
      distractors: [
        entry({ key: "A", type: "scope-difference", basis: { scope: "user@example.com のアカウントの上限" } }),
        ...base.slice(1),
      ],
    });
    expect(check(withEnv).blockers).toEqual([{ code: "distractor-forbidden-text", path: "distractors.0" }]);
  });

  it("誤答の型が 1 種類に偏る_警告する", () => {
    const same = (choiceDraft().distractors ?? []).map((d) => ({ ...d, type: "numeric-difference" as const }));
    expect(check(choiceDraft({ distractors: same })).warnings).toEqual([
      { code: "distractor-type-bias", path: "distractors" },
    ]);
  });

  it("誤答が 2 つだけなら_型が同じでも警告しない", () => {
    const d = choiceDraft({
      choices: [
        { key: "A", text: "10 個" },
        { key: "B", text: "100 個" },
        { key: "C", text: "1,000 個" },
      ],
      distractors: [entry({ key: "A", type: "numeric-difference" }), entry({ key: "C", type: "numeric-difference" })],
    });
    expect(check(d).warnings).toEqual([]);
  });

  describe("正答が複数になりうる候補", () => {
    it("正答とほぼ同じ文言の誤答_曖昧として検出される", () => {
      const d = choiceDraft({
        choices: [
          { key: "A", text: "リージョンごとに 100 個まで作成できる" },
          { key: "B", text: "リージョンごとに 100 個まで作成できます" },
          { key: "C", text: "1,000 個" },
          { key: "D", text: "上限はない" },
        ],
        correctAnswers: ["A"],
        distractors: [
          entry({ key: "B", type: "misconception" }),
          entry({ key: "C", type: "numeric-difference" }),
          entry({ key: "D", type: "misconception" }),
        ],
      });
      expect(check(d).ambiguous).toEqual([{ code: "similar-to-correct", path: "choices.1" }]);
    });

    it("根拠の主張がそのまま支える誤答_曖昧として検出される", () => {
      const d = choiceDraft({
        choices: [
          { key: "A", text: "10 個" },
          { key: "B", text: "バケットは 100 個まで" },
          { key: "C", text: "Widget Store のバケットは 100 個まで、リージョンごと" },
          { key: "D", text: "上限はない" },
        ],
        distractors: [
          entry({ key: "A", type: "numeric-difference" }),
          entry({ key: "C", type: "scope-difference", basis: { scope: "数える単位が違う" } }),
          entry({ key: "D", type: "misconception" }),
        ],
      });
      expect(check(d).ambiguous).toEqual([{ code: "supported-by-fact", path: "choices.2" }]);
    });

    it("根拠の主張と無関係な誤答_検出されない", () => {
      expect(check(choiceDraft()).ambiguous).toEqual([]);
    });
  });

  it("誤答の検査の結果_報告に本文が含まれない", () => {
    const d = choiceDraft({
      distractors: [entry({ key: "A", reason: "短", basis: { factId: "f-ffffffffffff" } })],
    });
    const text = JSON.stringify(check(d));
    expect(text).not.toContain("バケット");
    expect(text).not.toContain("短");
  });
});
