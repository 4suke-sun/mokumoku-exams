import { type Block, type Inline, parseBlocks, parseInline, splitListLabel } from "@/lib/rich-text.ts";

function Inlines({ items }: { items: Inline[] }) {
  return items.map((item, i) => {
    // 同じ文面が並んでも区別できるよう、位置を鍵にする(並びは変わらない)
    const key = `${i}-${item.kind}`;
    if (item.kind === "strong") return <strong key={key}>{item.text}</strong>;
    if (item.kind === "mark")
      return (
        <mark key={key} className="mark-emphasis">
          {item.text}
        </mark>
      );
    if (item.kind === "code") {
      // 切れ目のない長い名前でも、狭い幅で折り返す(画面の幅を超えて、ページ全体が縮んで表示されないように)
      return (
        <code key={key} className="wrap-anywhere rounded bg-bg px-1 font-mono text-[0.9em]">
          {item.text}
        </code>
      );
    }
    return <span key={key}>{item.text}</span>;
  });
}

/** 箇条書きの 1 項目。`boldLabels` のときは、「ラベル: 説明」のラベルを太くする */
function ListItem({ item, boldLabels }: { item: Inline[]; boldLabels: boolean }) {
  const split = boldLabels ? splitListLabel(item) : null;
  if (!split) return <Inlines items={item} />;
  return (
    <>
      <strong>{split.label}</strong>: <Inlines items={split.rest} />
    </>
  );
}

function BlockView({ block, boldLabels }: { block: Block; boldLabels: boolean }) {
  switch (block.kind) {
    case "heading":
      return (
        <p className="font-bold">
          <Inlines items={block.inlines} />
        </p>
      );
    case "list":
      return (
        <ul className="list-disc space-y-1 pl-6">
          {block.items.map((item, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 内容は固定で、並べ替えない
            <li key={i}>
              <ListItem item={item} boldLabels={boldLabels} />
            </li>
          ))}
        </ul>
      );
    case "code":
      return (
        <pre className="overflow-x-auto rounded-md border border-line bg-bg p-3 font-mono text-sm">
          <code>{block.text}</code>
        </pre>
      );
    case "paragraph":
      return (
        <p className="whitespace-pre-wrap">
          {block.lines.map((line, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 内容は固定で、並べ替えない
            <span key={i}>
              {i > 0 ? "\n" : null}
              <Inlines items={line} />
            </span>
          ))}
        </p>
      );
  }
}

/** 設問文・解説など、段落・箇条書き・コードを含む文面。`boldListLabels` で、箇条書きの「ラベル: 説明」のラベルを太くする。 */
export function RichText({
  text,
  className = "",
  id,
  boldListLabels = false,
  mark = false,
}: {
  text: string;
  className?: string;
  id?: string;
  boldListLabels?: boolean;
  /** `==強調==` を解釈する(カリキュラムの本文と要約で使う) */
  mark?: boolean;
}) {
  const blocks = parseBlocks(text, { mark });
  return <BlockList blocks={blocks} className={className} id={id} boldLabels={boldListLabels} />;
}

/** 解析済みのブロックを描く(本文を、パートに分けて別々の囲みに入れるときに使う) */
export function BlockList({
  blocks,
  className = "",
  id,
  boldLabels = false,
}: {
  blocks: Block[];
  className?: string;
  id?: string;
  boldLabels?: boolean;
}) {
  return (
    <div id={id} className={`space-y-3 leading-relaxed ${className}`}>
      {blocks.map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 内容は固定で、並べ替えない
        <BlockView key={i} block={block} boldLabels={boldLabels} />
      ))}
    </div>
  );
}

/** 選択肢など、1 つの流れの中に入れる文面。強調とコードだけを解釈し、改行は保つ。 */
export function InlineText({ text, mark = false }: { text: string; mark?: boolean }) {
  return (
    <span className="whitespace-pre-wrap">
      <Inlines items={parseInline(text, { mark })} />
    </span>
  );
}
