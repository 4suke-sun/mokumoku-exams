import { describe, expect, it } from "vitest";
import { leakedIds, probesOf } from "./unpublished-bundle-check.ts";

const file = {
  examCode: "EX-SMP-XX",
  entries: [
    {
      verdict: "rewritable",
      reasons: ["judge:choices-weak"],
      question: { questionId: "SAMPLE-0003", questionText: "非公開の設問文です。ここは十分な長さです。" },
    },
    {
      verdict: "unpublish",
      reasons: ["judge:not-unique"],
      question: { questionId: "SAMPLE-0004", questionText: "短い" },
    },
  ],
};

describe("非公開の問題の探す対象", () => {
  it("設問文と ID_そのままの形・JSON の文字列の形・\\uXXXX の形を対象にする", () => {
    const [p] = probesOf(file);
    expect(p?.id).toBe("SAMPLE-0003");
    expect(p?.needles).toContain('"SAMPLE-0003"');
    expect(p?.needles).toContain("非公開の設問文です。ここは十分な長さです。");
    expect(p?.needles.some((n) => n.includes("\\u"))).toBe(true);
  });

  it("短い設問文_偶然の一致を避けるため、ID だけを探す", () => {
    const probes = probesOf(file);
    expect(probes[1]?.needles).toEqual(['"SAMPLE-0004"']);
  });

  it("形が違う入力_飛ばす", () => {
    expect(probesOf(null)).toEqual([]);
    expect(probesOf({ entries: "x" })).toEqual([]);
    expect(probesOf({ entries: [{ question: {} }, null] })).toEqual([]);
  });
});

describe("成果物の中身の走査", () => {
  const probes = probesOf(file);

  it("含まれない_空の一覧", () => {
    expect(leakedIds('{"questionId":"SAMPLE-0001","questionText":"公開の設問"}', probes)).toEqual([]);
  });

  it("設問文がそのまま含まれる_ID を返す", () => {
    expect(leakedIds("x 非公開の設問文です。ここは十分な長さです。 y", probes)).toEqual(["SAMPLE-0003"]);
  });

  it("JSON の文字列として含まれる_引用符を含む設問文でも見つける", () => {
    const quoted = {
      entries: [
        { question: { questionId: "SAMPLE-0005", questionText: '「引用」を含む "二重引用符" の設問文です。' } },
      ],
    };
    const content = JSON.stringify({ questionText: quoted.entries[0]?.question.questionText });
    expect(leakedIds(content, probesOf(quoted))).toEqual(["SAMPLE-0005"]);
  });

  it("\\uXXXX で書かれて含まれる_見つける", () => {
    const content = `{"q":"${[..."非公開の設問文です。ここは十分な長さです。"].map((c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`).join("")}"}`;
    expect(leakedIds(content, probes)).toEqual(["SAMPLE-0003"]);
  });

  it("ID だけが引用符つきで含まれる_見つける。引用符のない一致は数えない", () => {
    expect(leakedIds('["SAMPLE-0004"]', probes)).toEqual(["SAMPLE-0004"]);
    expect(leakedIds("SAMPLE-0004", probes)).toEqual([]);
  });
});
