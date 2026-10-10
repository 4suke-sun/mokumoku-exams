import { type Block, type Inline, parseBlocks, parseInline } from "@/lib/rich-text.ts";

function Inlines({ items }: { items: Inline[] }) {
  return items.map((item, i) => {
    // 同じ文面が並んでも区別できるよう、位置を鍵にする(並びは変わらない)
    const key = `${i}-${item.kind}`;
    if (item.kind === "strong") return <strong key={key}>{item.text}</strong>;
    if (item.kind === "code") {
      return (
        <code key={key} className="rounded bg-bg px-1 font-mono text-[0.9em]">
          {item.text}
        </code>
      );
    }
    return <span key={key}>{item.text}</span>;
  });
}

function BlockView({ block }: { block: Block }) {
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
              <Inlines items={item} />
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

/** 設問文・解説など、段落・箇条書き・コードを含む文面。 */
export function RichText({ text, className = "", id }: { text: string; className?: string; id?: string }) {
  const blocks = parseBlocks(text);
  return (
    <div id={id} className={`space-y-3 leading-relaxed ${className}`}>
      {blocks.map((block, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: 内容は固定で、並べ替えない
        <BlockView key={i} block={block} />
      ))}
    </div>
  );
}

/** 選択肢など、1 つの流れの中に入れる文面。強調とコードだけを解釈し、改行は保つ。 */
export function InlineText({ text }: { text: string }) {
  return (
    <span className="whitespace-pre-wrap">
      <Inlines items={parseInline(text)} />
    </span>
  );
}
