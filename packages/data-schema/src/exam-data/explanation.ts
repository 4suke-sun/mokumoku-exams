/**
 * 解説の見出しの名前と、種類の対応(docs/data-spec.md の「6.1 解説の見出し」)。
 * アプリ(見出しごとのカードの表示)と作問パイプライン(下書きの解説の検査)が、同じ一覧を読む。
 * 表記ゆれは、データを直さず、ここの別名で吸収する。新しい見出しの名前を使うときは、ここと data-spec の表とテストに足す。
 */

/** 解説のカードの種類 */
export type ExplanationKind = "requirement" | "answer" | "knowledge" | "approach" | "summary" | "wrong" | "other";

/** 見出しの名前(コロンと前後の空白を除いたもの)と、種類の対応 */
export const HEADING_KINDS: Readonly<Record<string, ExplanationKind>> = {
  問われている要件: "requirement",
  要件: "requirement",
  正解の決め手: "answer",
  正解の理由: "answer",
  理由: "answer",
  前提知識: "knowledge",
  解くための考え方: "approach",
  考え方: "approach",
  まとめ: "summary",
  他の選択肢が誤りである理由: "wrong",
  他の選択肢が誤りの理由: "wrong",
  誤りの選択肢: "wrong",
};

/** 見出しの名前をそろえる(前後の空白と、末尾の半角・全角のコロンを除く) */
export function normalizeHeading(text: string): string {
  return text
    .trim()
    .replace(/[:：]\s*$/, "")
    .trim();
}

/** 段落が、決まった見出しの名前だけか。そうなら種類を返す */
export function headingKind(paragraph: string): ExplanationKind | null {
  const name = normalizeHeading(paragraph);
  return Object.hasOwn(HEADING_KINDS, name) ? (HEADING_KINDS[name] ?? null) : null;
}

/** 見出しの前の段落の題 */
export const INTRO_TITLE = "問われている要件";

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

/** 見出しで区切った段落のまとまり */
export type ExplanationGroup = { kind: ExplanationKind; title: string; paragraphs: string[] };

/**
 * 解説を見出しで区切る。見出しの前の段落は「問われている要件」のまとまりにする。
 * `## ` の見出しで、対応表にない名前は、その名前の普通のまとまり(other)にする。
 */
export function explanationGroups(source: string): ExplanationGroup[] {
  const groups: ExplanationGroup[] = [];
  let current: ExplanationGroup = { kind: "requirement", title: INTRO_TITLE, paragraphs: [] };
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
  return groups;
}

type ChoiceLike = { key: string; text: string };

/** 選択肢の文を比べる形(空白と句読点を除く。解説では、英字の前後の空白や、読点・句点を省いて引くことがある) */
function choiceTextKey(text: string): string {
  return text.replace(/[\s、,。.]/g, "");
}

/** 誤りの理由の節の部分。choice は選択肢の文の段落と、次の理由の段落の組。text は組にできない段落 */
export type WrongReasonBlock =
  | { type: "text"; text: string }
  | { type: "choice"; choiceKey: string; choiceText: string; reason: string };

/** 誤りの理由の節: 選択肢の文の段落と、次の理由の段落を組にする。組にできない段落は、普通の段落のまま */
export function pairChoices(paragraphs: readonly string[], choices: readonly ChoiceLike[]): WrongReasonBlock[] {
  const byText = new Map(choices.map((c) => [choiceTextKey(c.text), c]));
  const blocks: WrongReasonBlock[] = [];
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

/** 誤りの理由の節(複数あればすべて)で、選択肢ごとの組にできない段落の数。節がなければ 0 */
export function unpairedWrongParagraphs(source: string, choices: readonly ChoiceLike[]): number {
  return explanationGroups(source)
    .filter((g) => g.kind === "wrong")
    .flatMap((g) => pairChoices(g.paragraphs, choices))
    .filter((b) => b.type === "text").length;
}
