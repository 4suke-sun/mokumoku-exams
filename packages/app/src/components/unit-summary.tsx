import { InlineText } from "@/components/rich-text.tsx";

/** 単元の要約(短い箇条書き)。要約のない単元では何も出さない。 */
export function UnitSummary({ summary }: { summary?: readonly string[] }) {
  if (!summary || summary.length === 0) return null;
  return (
    // 節の ID(英小文字・数字・ハイフン)と重ならないよう、下線を含む ID にする
    <section aria-labelledby="study_summary-title" className="space-y-2 rounded-lg border border-line bg-surface p-4">
      <h2 id="study_summary-title" className="text-xl font-bold">
        この単元の要点
      </h2>
      <ul className="list-disc space-y-1 pl-6">
        {summary.map((point, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 内容は固定で、並べ替えない
          <li key={i}>
            <InlineText text={point} />
          </li>
        ))}
      </ul>
    </section>
  );
}
