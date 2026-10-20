import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { PASSING, resolveProfile } from "./profiles.ts";
import { BATCH_ITEMS, QUESTION_ITEMS } from "./score.ts";

const docsDir = resolve(import.meta.dirname, "../../../../docs/exam-style");
const read = (name: string) => readFileSync(resolve(docsDir, name), "utf8");

const clf = resolveProfile("AWS-CLF-C02");
const dva = resolveProfile("AWS-DVA-C02");
if (clf === null || dva === null) throw new Error("帯がない");

describe("点数票の文書と実装の一致", () => {
  const text = read("scorecard.md");

  it.each([...QUESTION_ITEMS, ...BATCH_ITEMS])("項目 %s_点数票の文書の表に行がある", (id) => {
    expect(text).toMatch(new RegExp(`^\\| ${id} \\|`, "m"));
  });

  it("合格点_文書の値が実装と同じ", () => {
    expect(text).toContain(`問題 1 問が **${PASSING.question} 点**`);
    expect(text).toContain(`束が **${PASSING.batch} 点**`);
    expect(text).toContain(`${PASSING.batchMinQuestions} 問以上`);
  });

  it.each([
    ["AWS-CLF-C02", clf],
    ["AWS-DVA-C02", dva],
  ] as const)("資格別の配点 %s_文書の表が実装と同じ", (code, profile) => {
    const p = profile.points;
    const row = [
      p.stemLength,
      p.contextSentences,
      p.contextRequirement,
      p.optionLength,
      p.opener,
      p.questionEnding,
      p.questionParagraph,
    ];
    const total = row.reduce((a, b) => a + b, 0);
    expect(total).toBe(40);
    expect(text).toContain(`| ${code} | ${[...row, total].join(" | ")} |`);
  });
});

describe("資格別の文書と帯の一致", () => {
  it.each([
    ["aws-clf.md", clf],
    ["aws-dva.md", dva],
  ] as const)("%s_帯の値が実装と同じ", (file, profile) => {
    const doc = read(file);
    const { full, partial } = profile.stemLength;
    expect(doc).toContain(`${full[0]}〜${full[1]}(満点)、${partial[0]}〜${partial[1]}(部分点)`);
    expect(doc).toContain(`${profile.contextSentences[0]}〜${profile.contextSentences[1]}`);
    expect(doc).toContain(`${profile.optionMaxLength[0]} 以内(満点)、${profile.optionMaxLength[1]} 以内(部分点)`);
    expect(doc).toContain(`${profile.lengthRatio[0]} 倍以内(満点)、${profile.lengthRatio[1]} 倍以内(部分点)`);
    expect(doc).toContain(`${profile.similarityMax} 未満`);
    const b = profile.batch;
    expect(doc).toContain(`${b.stemMedian[0]}〜${b.stemMedian[1]} 字`);
    expect(doc).toContain(`${b.stemP90Max} 字以下`);
    expect(doc).toContain(`${b.openerPrefixChars} 文字が同じもの`);
    expect(doc).toContain(`${Math.round(b.openerTopMax * 100)}% 以下`);
    expect(doc).toContain(`複数選択の割合(束) | ${Math.round(b.multiShare[1] * 100)}% 以下`);
    if (b.sentenceShare[0] > 0) expect(doc).toContain(`文が ${Math.round(b.sentenceShare[0] * 100)}% 以上`);
    else expect(doc).toContain(`文 ${Math.round(b.sentenceShare[1] * 100)}% 以下`);
  });

  it("書き方の文書_README から資格別の文書と点数票へたどれる", () => {
    const readme = read("README.md");
    for (const name of ["aws-common.md", "aws-clf.md", "aws-dva.md", "scorecard.md"])
      expect(readme).toContain(`./${name}`);
  });
});
