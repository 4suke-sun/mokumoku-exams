import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  explanationParagraphs,
  HEADING_KINDS,
  headingKind,
  normalizeHeading,
  parseExplanation,
  splitParagraphs,
} from "./explanation.ts";
import type { Question } from "./types.ts";

describe("見出しの名前と種類の対応", () => {
  it.each([
    ["問われている要件", "requirement"],
    ["正解の決め手", "answer"],
    ["理由", "answer"],
    ["前提知識", "knowledge"],
    ["解くための考え方", "approach"],
    ["まとめ", "summary"],
    ["他の選択肢が誤りである理由", "wrong"],
    ["他の選択肢が誤りである理由:", "wrong"],
    ["他の選択肢が誤りである理由：", "wrong"],
    [" 前提知識 ", "knowledge"],
  ])("%s_%s", (name, kind) => {
    expect(headingKind(name)).toBe(kind);
  });

  it("対応表にない名前_見出しとして扱わない", () => {
    expect(headingKind("ルールベースと機械学習の使い分け")).toBeNull();
    expect(headingKind("前提知識の確認です。")).toBeNull();
  });

  it("対応表の名前_そろえた形で書いてある", () => {
    for (const name of Object.keys(HEADING_KINDS)) expect(normalizeHeading(name)).toBe(name);
  });
});

describe("splitParagraphs", () => {
  it("空行で分け_## の行は 1 つの段落にし_コードの中の空行では分けない", () => {
    expect(splitParagraphs("## 理由\n本文\n\n```\na\n\nb\n```\n\n- x\n- y")).toEqual([
      "## 理由",
      "本文",
      "```\na\n\nb\n```",
      "- x\n- y",
    ]);
  });
});

describe("parseExplanation", () => {
  const choices = [
    { key: "A", text: "正解の選択肢" },
    { key: "B", text: "誤りの選択肢 1" },
    { key: "C", text: "誤りの選択肢 2" },
  ];
  const source = [
    "この問題は、要件を問うものです。",
    "決め手の説明です。",
    "前提知識",
    "用語の題",
    "用語の説明です。",
    "他の選択肢が誤りである理由：",
    "誤りの選択肢 1",
    "理由 1 です。",
    "誤りの選択肢 2",
    "理由 2 です。",
  ].join("\n\n");

  it("見出しの前は要件のカード_見出しごとにカードにし_誤りの理由は選択肢ごとの組にする", () => {
    expect(parseExplanation(source, choices)).toEqual([
      {
        kind: "requirement",
        title: "問われている要件",
        blocks: [
          { type: "text", text: "この問題は、要件を問うものです。" },
          { type: "text", text: "決め手の説明です。" },
        ],
      },
      {
        kind: "knowledge",
        title: "前提知識",
        blocks: [
          { type: "term", text: "用語の題" },
          { type: "text", text: "用語の説明です。" },
        ],
      },
      {
        kind: "wrong",
        title: "他の選択肢が誤りである理由",
        blocks: [
          { type: "choice", choiceKey: "B", choiceText: "誤りの選択肢 1", reason: "理由 1 です。" },
          { type: "choice", choiceKey: "C", choiceText: "誤りの選択肢 2", reason: "理由 2 です。" },
        ],
      },
    ]);
  });

  it("組にできない段落_普通の段落のまま出す", () => {
    const sections = parseExplanation(
      "他の選択肢が誤りである理由\n\nどの選択肢でもない段落\n\n誤りの選択肢 1",
      choices,
    );
    expect(sections[0]?.blocks).toEqual([
      { type: "text", text: "どの選択肢でもない段落" },
      { type: "text", text: "誤りの選択肢 1" },
    ]);
  });

  it("## の見出し_対応表にない名前は普通のカードにする", () => {
    expect(parseExplanation("## 理由\n\n本文\n\n## 補足の話\n\n続き")).toEqual([
      { kind: "answer", title: "理由", blocks: [{ type: "text", text: "本文" }] },
      { kind: "other", title: "補足の話", blocks: [{ type: "text", text: "続き" }] },
    ]);
  });

  it("見出しのない解説_要件のカード 1 枚にする", () => {
    expect(parseExplanation("1 週間は 7 日です。")).toEqual([
      { kind: "requirement", title: "問われている要件", blocks: [{ type: "text", text: "1 週間は 7 日です。" }] },
    ]);
  });
});

describe("今のデータの解説", () => {
  const dataDir = join(import.meta.dirname, "../../../../data");
  const questions = readdirSync(dataDir)
    .filter((name) => /^questions\..+\.json$/.test(name))
    .flatMap((name) => (JSON.parse(readFileSync(join(dataDir, name), "utf8")) as { questions: Question[] }).questions);

  it("問題がある", () => {
    expect(questions.length).toBeGreaterThan(0);
  });

  it("すべての問題で_本文が欠けずにカードになる(見出しの段落だけを除く)", () => {
    for (const question of questions) {
      const choices = question.questionType === "free-text" ? [] : question.choices;
      const sections = parseExplanation(question.explanation, choices);
      const expected = splitParagraphs(question.explanation).filter(
        (p) => !p.startsWith("## ") && headingKind(p) === null,
      );
      expect(explanationParagraphs(sections), question.questionId).toEqual(expected);
      expect(sections.length, question.questionId).toBeGreaterThan(0);
    }
  });

  it("誤りの理由の節_選択肢ごとの組にできる", () => {
    let paired = 0;
    for (const question of questions) {
      if (question.questionType === "free-text") continue;
      const wrong = parseExplanation(question.explanation, question.choices).find((s) => s.kind === "wrong");
      if (!wrong) continue;
      expect(
        wrong.blocks.every((b) => b.type === "choice"),
        question.questionId,
      ).toBe(true);
      paired++;
    }
    expect(paired).toBeGreaterThan(0);
  });
});
