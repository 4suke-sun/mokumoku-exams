// 解説を、見出しごとのカードに分ける(docs/data-spec.md の「解説の見出し」)。
// 見出しは、`## ` で始まる行か、段落がちょうど決まった見出しの名前だけのもの(末尾のコロンの有無は問わない)。
// 表記ゆれは、データを直さず、データの契約の対応表(別名)で吸収する。本文は欠けさせない(分けられないものは、普通の段落のまま出す)。

// 見出しの名前と種類の対応は、作問パイプラインと同じ一覧を、データの契約から読む
import {
  type ExplanationKind,
  HEADING_KINDS,
  headingKind,
  normalizeHeading,
} from "@mokumoku-exams/data-schema/exam-data/explanation";

export { type ExplanationKind, HEADING_KINDS, headingKind, normalizeHeading };

/** 見出しの前の段落に付ける題 */
export const INTRO_TITLE = "問われている要件";

/** カードの中の部分。text は普通の段落、term は用語の題、choice は選択肢と、それが誤りである理由の組 */
export type ExplanationBlock =
  | { type: "text"; text: string }
  | { type: "term"; text: string }
  | { type: "choice"; choiceKey: string; choiceText: string; reason: string };

export type ExplanationSection = { kind: ExplanationKind; title: string; blocks: ExplanationBlock[] };

/**
 * 段落に分ける。空行で区切り、コードの範囲(```)の中の空行では区切らない。`## ` の行は、それだけで 1 つの段落にする。
 */
export function splitParagraphs(source: string): string[] {
  const paragraphs: string[] = [];
  let current: string[] = [];
  let inCode = false;
  const flush = () => {
    if (current.some((line) => line.trim() !== "")) paragraphs.push(current.join("\n").trim());
    current = [];
  };
  for (const line of source.split("\n")) {
    if (line.trim().startsWith("```")) inCode = !inCode;
    if (!inCode && line.startsWith("## ")) {
      flush();
      paragraphs.push(line);
      continue;
    }
    if (!inCode && line.trim() === "") flush();
    else current.push(line);
  }
  flush();
  return paragraphs;
}

/** 用語の題とみなす段落(前提知識の中の、句点を含まない短い 1 行) */
function isTerm(paragraph: string): boolean {
  return (
    paragraph.length <= 40 && !paragraph.includes("\n") && !/[。.]$/.test(paragraph) && !paragraph.startsWith("- ")
  );
}

type ChoiceLike = { key: string; text: string };

/** 選択肢の文を比べる形(空白と句読点を除く。解説では、英字の前後の空白や、読点・句点を省いて引くことがある) */
function choiceTextKey(text: string): string {
  return text.replace(/[\s、,。.]/g, "");
}

/** 誤りの理由の節: 選択肢の文の段落と、次の理由の段落を組にする。組にできない段落は、普通の段落のまま */
function pairChoices(paragraphs: readonly string[], choices: readonly ChoiceLike[]): ExplanationBlock[] {
  const byText = new Map(choices.map((c) => [choiceTextKey(c.text), c]));
  const blocks: ExplanationBlock[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i] as string;
    const choice = byText.get(choiceTextKey(paragraph));
    const reason = paragraphs[i + 1];
    if (choice && reason !== undefined && !byText.has(choiceTextKey(reason))) {
      blocks.push({ type: "choice", choiceKey: choice.key, choiceText: paragraph, reason });
      i++;
    } else {
      blocks.push({ type: "text", text: paragraph });
    }
  }
  return blocks;
}

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
  const groups: { kind: ExplanationKind; title: string; paragraphs: string[] }[] = [];
  let current = { kind: "requirement" as ExplanationKind, title: INTRO_TITLE, paragraphs: [] as string[] };
  for (const paragraph of splitParagraphs(source)) {
    const marked = paragraph.startsWith("## ") ? paragraph.slice(3) : null;
    const kind = marked !== null ? (headingKind(marked) ?? "other") : headingKind(paragraph);
    if (kind === null) {
      current.paragraphs.push(paragraph);
      continue;
    }
    if (current.paragraphs.length > 0) groups.push(current);
    current = { kind, title: normalizeHeading(marked ?? paragraph), paragraphs: [] };
  }
  if (current.paragraphs.length > 0 || current.title !== INTRO_TITLE) groups.push(current);
  return groups.map((group) => ({
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
