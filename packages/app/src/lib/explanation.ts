// 解説を、見出しごとのカードに分ける(docs/data-spec.md の「解説の見出し」)。
// 見出しは、`## ` で始まる行か、段落がちょうど決まった見出しの名前だけのもの(末尾のコロンの有無は問わない)。
// 表記ゆれは、データを直さず、データの契約の対応表(別名)で吸収する。本文は欠けさせない(分けられないものは、普通の段落のまま出す)。

// 見出しの名前と種類の対応、段落の分け方、誤りの理由の組の作り方は、作問パイプラインと同じものを、データの契約から読む
import {
  type ExplanationKind,
  explanationGroups,
  HEADING_KINDS,
  headingKind,
  INTRO_TITLE,
  normalizeHeading,
  pairChoices,
  splitParagraphs,
} from "@mokumoku-exams/data-schema/exam-data/explanation";

export { type ExplanationKind, HEADING_KINDS, headingKind, INTRO_TITLE, normalizeHeading, splitParagraphs };

/** カードの中の部分。text は普通の段落、term は用語の題、choice は選択肢と、それが誤りである理由の組 */
export type ExplanationBlock =
  | { type: "text"; text: string }
  | { type: "term"; text: string }
  | { type: "choice"; choiceKey: string; choiceText: string; reason: string };

export type ExplanationSection = { kind: ExplanationKind; title: string; blocks: ExplanationBlock[] };

/** 用語の題とみなす段落(前提知識の中の、句点を含まない短い 1 行) */
function isTerm(paragraph: string): boolean {
  return (
    paragraph.length <= 40 && !paragraph.includes("\n") && !/[。.]$/.test(paragraph) && !paragraph.startsWith("- ")
  );
}

type ChoiceLike = { key: string; text: string };

function blocksOf(kind: ExplanationKind, paragraphs: readonly string[], choices: readonly ChoiceLike[]) {
  if (kind === "wrong") return pairChoices(paragraphs, choices);
  return paragraphs.map((text, i): ExplanationBlock => {
    const next = paragraphs[i + 1];
    return kind === "knowledge" && next !== undefined && isTerm(text) ? { type: "term", text } : { type: "text", text };
  });
}

/**
 * 解説をカードに分ける。見出しの前の段落は「問われている要件」のカードにする。
 * `## ` の見出しで、対応表にない名前は、その名前の普通のカード(other)にする。
 */
export function parseExplanation(source: string, choices: readonly ChoiceLike[] = []): ExplanationSection[] {
  return explanationGroups(source).map((group) => ({
    kind: group.kind,
    title: group.title,
    blocks: blocksOf(group.kind, group.paragraphs, choices),
  }));
}

/** カードに出る本文(見出しを除く段落)。本文が欠けていないことの確かめに使う */
export function explanationParagraphs(sections: readonly ExplanationSection[]): string[] {
  return sections.flatMap((section) =>
    section.blocks.flatMap((block) => (block.type === "choice" ? [block.choiceText, block.reason] : [block.text])),
  );
}
