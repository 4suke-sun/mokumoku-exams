// 設問文・選択肢・解説で使える、限定した記法(docs/data-spec.md の「文字の書き方」)。
// HTML には変換せず、構造だけを返す。画面側が React の要素として組むので、書かれた文字が HTML として解釈されることはない。

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "mark"; text: string };

/** 解釈する記法の範囲。`mark`(`==強調==`)は、カリキュラムの本文と要約だけで有効にする(docs/data-spec.md の「文字の書き方」) */
export type ParseOptions = { mark?: boolean };

export type Block =
  | { kind: "paragraph"; lines: Inline[][] }
  | { kind: "heading"; inlines: Inline[] }
  | { kind: "list"; items: Inline[][] }
  | { kind: "code"; text: string };

const INLINE = /(\*\*[^*\n]+\*\*|`[^`\n]+`)/;
const INLINE_WITH_MARK = /(\*\*[^*\n]+\*\*|`[^`\n]+`|==[^=\n]+==)/;

export function parseInline(source: string, { mark = false }: ParseOptions = {}): Inline[] {
  return source
    .split(mark ? INLINE_WITH_MARK : INLINE)
    .filter((part) => part !== "")
    .map((part): Inline => {
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
        return { kind: "strong", text: part.slice(2, -2) };
      }
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) {
        return { kind: "code", text: part.slice(1, -1) };
      }
      if (mark && part.startsWith("==") && part.endsWith("==") && part.length > 4) {
        return { kind: "mark", text: part.slice(2, -2) };
      }
      return { kind: "text", text: part };
    });
}

/** 空行で段落を分ける。`- ` の行は箇条書き、`## ` の行は見出し、``` で囲んだ範囲はコード。 */
export function parseBlocks(source: string, options: ParseOptions = {}): Block[] {
  const blocks: Block[] = [];
  const lines = source.replace(/\r\n?/g, "\n").split("\n");
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length > 0)
      blocks.push({ kind: "paragraph", lines: paragraph.map((line) => parseInline(line, options)) });
    paragraph = [];
  };
  const flushList = () => {
    if (list.length > 0) blocks.push({ kind: "list", items: list.map((item) => parseInline(item, options)) });
    list = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] as string;
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      const code: string[] = [];
      i++;
      // 閉じのないフェンスは、末尾までをコードとして扱う
      while (i < lines.length && !(lines[i] as string).startsWith("```")) {
        code.push(lines[i] as string);
        i++;
      }
      blocks.push({ kind: "code", text: code.join("\n") });
    } else if (line.trim() === "") {
      flushParagraph();
      flushList();
    } else if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      blocks.push({ kind: "heading", inlines: parseInline(line.slice(3), options) });
    } else if (line.startsWith("- ")) {
      flushParagraph();
      list.push(line.slice(2));
    } else {
      flushList();
      paragraph.push(line);
    }
  }
  flushParagraph();
  flushList();
  return blocks;
}

// 「ラベル: 説明」の形の箇条書きの、ラベル。短い語(句読点を含まない 20 文字まで)と、半角か全角のコロンで見分ける
const LIST_LABEL = /^([^:：。、\n]{1,20})[:：]\s*/;

/**
 * 箇条書きの 1 項目が「ラベル: 説明」の形なら、ラベルと残りに分ける(ラベルを太くして見せるため)。
 * 先頭が強調やコードの項目と、コロンの後ろが空の項目は、分けない。
 */
export function splitListLabel(item: Inline[]): { label: string; rest: Inline[] } | null {
  const [first, ...others] = item;
  if (first?.kind !== "text") return null;
  const match = LIST_LABEL.exec(first.text);
  if (!match) return null;
  const remaining = first.text.slice(match[0].length);
  const rest: Inline[] = remaining === "" ? others : [{ kind: "text", text: remaining }, ...others];
  return rest.length === 0 ? null : { label: match[1] as string, rest };
}
