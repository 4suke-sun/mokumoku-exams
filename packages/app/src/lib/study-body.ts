import { type Block, parseBlocks } from "./rich-text.ts";

// 教科書の本文を、パートに分ける(docs/data-spec.md の「カリキュラムのデータ」)。データに専用の項目は持たず、書き方の決まりで見分ける。
// - 単元の最初の節の、最初の段落: 「この単元で学ぶこと」
// - 見出し「押さえどころ」から、節の終わりまで: 「ここがポイント」
// - それ以外: 本文

/** 「ここがポイント」の見出しとして扱う、本文の見出しの文字 */
export const POINT_HEADING = "押さえどころ";

export type BodyParts = {
  /** 「この単元で学ぶこと」(最初の節だけ。なければ空) */
  goal: Block[];
  /** 本文 */
  main: Block[];
  /** 「ここがポイント」 */
  point: Block[];
};

function isPointHeading(block: Block): boolean {
  return (
    block.kind === "heading" &&
    block.inlines
      .map((i) => i.text)
      .join("")
      .trim() === POINT_HEADING
  );
}

/** 節の本文を、パートに分ける。`first` は、単元の最初の節か(最初の段落を、学ぶことにするのは最初の節だけ) */
export function splitBody(body: string, first: boolean): BodyParts {
  const blocks = parseBlocks(body, { mark: true });
  const at = blocks.findIndex(isPointHeading);
  const before = at < 0 ? blocks : blocks.slice(0, at);
  const point = at < 0 ? [] : blocks.slice(at + 1);
  const [head, ...rest] = before;
  if (first && head?.kind === "paragraph") return { goal: [head], main: rest, point };
  return { goal: [], main: before, point };
}
