import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { type Candidate, candidateOf, findDuplicates, readPublishedCandidates } from "./dedupe.ts";
import { baseConfig, choiceDraft } from "./test-helpers.ts";

const thresholds = { duplicate: 0.85, hold: 0.6 };
const BASE = "Widget Store で、1 つのアカウントがリージョンごとに作れるバケットの上限数はどれですか。";

const existing = (ref: string, text: string, answers?: string): Candidate => ({
  ref,
  source: "existing",
  text,
  ...(answers !== undefined ? { answers } : {}),
});
const target = (text = BASE): Candidate => ({
  ref: "d-111111111111",
  source: "draft",
  text,
  factKey: "f-aaaaaaaaaaaa",
});

describe("findDuplicates", () => {
  it("既存の問題とほぼ同じ設問文_重複として落とす", () => {
    const near = "Widget Store で、1 つのアカウントがリージョンごとに作れるバケットの上限数はいくつですか。";
    expect(findDuplicates(target(), [existing("AIB-0001", near)], thresholds)).toEqual([
      { level: "duplicate", kind: "similar", other: "AIB-0001", source: "existing", score: 0.93 },
    ]);
  });

  it("しきい値の範囲に入る設問文_保留として報告する", () => {
    const close = "Widget Store で、1 つのアカウントが 1 リージョンに作成できるバケット数の上限はどれですか。";
    const found = findDuplicates(target(), [existing("AIB-0002", close)], thresholds);
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ level: "hold", kind: "similar", other: "AIB-0002" });
    expect(found[0]?.score).toBeGreaterThanOrEqual(0.6);
    expect(found[0]?.score).toBeLessThan(0.85);
  });

  it("無関係な設問文_検出されない", () => {
    const other = "ログの保管期間を延ばすには、どの設定を変更しますか。";
    expect(findDuplicates(target(), [existing("AIB-0003", other)], thresholds)).toEqual([]);
  });

  it("下書き同士の重複も検出される", () => {
    const sibling: Candidate = { ...target(BASE.replace("どれ", "いくつ")), ref: "d-222222222222" };
    const found = findDuplicates(target(), [sibling], thresholds);
    expect(found).toEqual([
      { level: "duplicate", kind: "similar", other: "d-222222222222", source: "draft", score: 0.93 },
    ]);
  });

  it("自分自身_比べない", () => {
    expect(findDuplicates(target(), [target()], thresholds)).toEqual([]);
  });

  it("同じ事実カードの組を根拠にし_設問文が少し似ている_論点が同じとして保留にする", () => {
    const sibling: Candidate = {
      ref: "d-222222222222",
      source: "draft",
      text: "Widget Store のバケットについて、正しい説明を選択してください。",
      factKey: "f-aaaaaaaaaaaa",
    };
    expect(findDuplicates(target(), [sibling], thresholds)).toMatchObject([
      { level: "hold", kind: "topic", other: "d-222222222222" },
    ]);
  });

  it("事実カードの組が違う_設問文が少し似ていても検出されない", () => {
    const sibling: Candidate = {
      ref: "d-222222222222",
      source: "draft",
      text: "Widget Store のバケットについて、正しい説明を選択してください。",
      factKey: "f-bbbbbbbbbbbb",
    };
    expect(findDuplicates(target(), [sibling], thresholds)).toEqual([]);
  });

  it("同じ正答の組を持ち_設問文が少し似ている_論点が同じとして保留にする", () => {
    const answers = "リージョンごとに数える上限として定められている数";
    const mine: Candidate = { ...target(), factKey: undefined, answers };
    const found = findDuplicates(
      mine,
      [existing("AIB-0004", "Widget Store のバケットの数え方はどれですか。", answers)],
      thresholds,
    );
    expect(found).toMatchObject([{ level: "hold", kind: "topic", other: "AIB-0004", source: "existing" }]);
  });

  it("正答が短すぎる(数値だけなど)_正答が同じでも論点が同じとはみなさない", () => {
    const mine: Candidate = { ...target(), factKey: undefined, answers: "100個" };
    const found = findDuplicates(
      mine,
      [existing("AIB-0005", "Widget Store のバケットの数え方はどれですか。", "100個")],
      thresholds,
    );
    expect(found).toEqual([]);
  });

  it("しきい値を変えられる", () => {
    const close = "Widget Store で、1 つのアカウントが 1 リージョンに作成できるバケット数の上限はどれですか。";
    const strict = { duplicate: 0.75, hold: 0.5 };
    expect(findDuplicates(target(), [existing("AIB-0002", close)], strict)[0]?.level).toBe("duplicate");
  });

  it("報告に本文が含まれない", () => {
    const near = BASE.replace("どれ", "いくつ");
    expect(JSON.stringify(findDuplicates(target(), [existing("AIB-0001", near)], thresholds))).not.toContain("Widget");
  });
});

describe("candidateOf", () => {
  it("正答の文言と根拠の事実カードの組を持ち_並びに依らない", () => {
    const a = candidateOf("d-111111111111", "draft", choiceDraft({ factIds: ["f-bbbbbbbbbbbb", "f-aaaaaaaaaaaa"] }));
    const b = candidateOf("d-111111111111", "draft", choiceDraft({ factIds: ["f-aaaaaaaaaaaa", "f-bbbbbbbbbbbb"] }));
    expect(a.factKey).toBe("f-aaaaaaaaaaaa,f-bbbbbbbbbbbb");
    expect(a).toEqual(b);
    expect(a.answers).toBe("100個");
  });
});

describe("readPublishedCandidates", () => {
  function rootWith(file?: unknown): string {
    const root = mkdtempSync(join(tmpdir(), "pipeline-dedupe-"));
    mkdirSync(join(root, "data"));
    if (file !== undefined) {
      writeFileSync(
        join(root, "data/questions.aws-aib-c01.json"),
        typeof file === "string" ? file : JSON.stringify(file),
      );
    }
    return root;
  }
  const question = {
    questionId: "AIB-0001",
    examCode: "AWS-AIB-C01",
    domain: "domain1",
    questionType: "single",
    questionText: "架空の設問です。",
    choices: [
      { key: "A", text: "選択肢 A" },
      { key: "B", text: "選択肢 B" },
    ],
    correctAnswers: ["B"],
    explanation: "架空の解説です。",
  };

  it("問題データがない_空", () => {
    expect(readPublishedCandidates(baseConfig, rootWith(), "AWS-AIB-C01")).toEqual([]);
  });

  it("公開済みの問題_識別子と設問文と正答の文言を読む", () => {
    const root = rootWith({ examCode: "AWS-AIB-C01", questions: [question] });
    expect(readPublishedCandidates(baseConfig, root, "AWS-AIB-C01")).toEqual([
      { ref: "AIB-0001", source: "existing", text: "架空の設問です。", answers: "選択肢b" },
    ]);
  });

  it("形が違う問題データ_invalid", () => {
    expect(
      readPublishedCandidates(baseConfig, rootWith({ examCode: "AWS-AIB-C01", questions: [{}] }), "AWS-AIB-C01"),
    ).toBe("invalid");
    expect(readPublishedCandidates(baseConfig, rootWith("{ broken"), "AWS-AIB-C01")).toBe("invalid");
  });
});
