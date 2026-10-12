import { InlineText } from "@/components/rich-text.tsx";
import { StudyCard } from "@/components/study-card.tsx";

/** 単元の要約(短い箇条書き)を、✓ の印つきの「この単元の要点」のカードで出す。要約のない単元では何も出さない。 */
export function UnitSummary({ summary }: { summary?: readonly string[] }) {
  if (!summary || summary.length === 0) return null;
  return (
    // 節の ID(英小文字・数字・ハイフン)と重ならないよう、下線を含む ID にする
    <StudyCard id="study_summary" tone="correct" icon="✅" title="この単元の要点">
      <ul className="space-y-2">
        {summary.map((point, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 内容は固定で、並べ替えない
          <li key={i} className="flex gap-2">
            <span aria-hidden="true" className="font-bold text-correct">
              ✓
            </span>
            <span>
              <InlineText text={point} mark />
            </span>
          </li>
        ))}
      </ul>
    </StudyCard>
  );
}
