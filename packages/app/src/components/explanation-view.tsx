import { ChoiceChip } from "@/components/choice-review.tsx";
import { RichText } from "@/components/rich-text.tsx";
import { type ExplanationKind, parseExplanation } from "@/lib/explanation.ts";
import type { ChoiceOrder } from "@/lib/quiz.ts";
import { displayLabels, orderChoices, relabelText } from "@/lib/quiz.ts";
import type { Question } from "@/lib/types.ts";

/** 種類ごとの色(globals.css の tone-*)とアイコン(飾り。見出しの文字で種類を伝える) */
const KIND_STYLE: Record<ExplanationKind, { tone: string; icon: string }> = {
  requirement: { tone: "tone-primary", icon: "🎯" },
  answer: { tone: "tone-correct", icon: "✅" },
  knowledge: { tone: "tone-violet", icon: "📘" },
  approach: { tone: "tone-orange", icon: "🧭" },
  summary: { tone: "tone-correct", icon: "📝" },
  wrong: { tone: "tone-incorrect", icon: "❌" },
  other: { tone: "tone-muted", icon: "💬" },
};

/**
 * 解説を、見出しごとの色とアイコンのカードで表す(lib/explanation.ts)。選択肢を記号で指している箇所は、画面の記号に置き換える。
 * 補足は「さらに詳しく」の折りたたみにする。
 */
export function ExplanationView({
  question,
  choiceOrder,
  headingLevel = 3,
}: {
  question: Question;
  choiceOrder?: ChoiceOrder;
  /** カードの見出しの段階(置く場所の見出しに合わせる) */
  headingLevel?: 3 | 4;
}) {
  const choices = question.questionType === "free-text" ? [] : orderChoices(question, choiceOrder);
  const labels = displayLabels(choices);
  const relabel = (text: string) => relabelText(text, labels);
  const sections = parseExplanation(question.explanation, choices);
  const Heading = headingLevel === 3 ? "h3" : "h4";

  return (
    <div className="space-y-3">
      {sections.map((section, i) => {
        const style = KIND_STYLE[section.kind];
        return (
          // biome-ignore lint/suspicious/noArrayIndexKey: 解説の並びは固定で、並べ替えない
          <section key={i} data-kind={section.kind} className={`exp-card ${style.tone}`}>
            <Heading className="exp-head">
              <span aria-hidden="true" className="exp-icon">
                {style.icon}
              </span>
              {relabel(section.title)}
            </Heading>
            <div className="mt-2 space-y-3">
              {section.blocks.map((block, j) => {
                const key = `${j}-${block.type}`;
                if (block.type === "term") {
                  return (
                    <p key={key} className="font-bold">
                      {relabel(block.text)}
                    </p>
                  );
                }
                if (block.type === "choice") {
                  return (
                    <div key={key} className="exp-item flex items-start gap-3">
                      <ChoiceChip label={labels.get(block.choiceKey) ?? block.choiceKey} />
                      <div className="min-w-0 space-y-1">
                        <p className="font-bold">{relabel(block.choiceText)}</p>
                        <RichText text={relabel(block.reason)} />
                      </div>
                    </div>
                  );
                }
                return <RichText key={key} text={relabel(block.text)} boldListLabels />;
              })}
            </div>
          </section>
        );
      })}
      {question.supplement ? (
        <details className="exp-card exp-more tone-muted">
          <summary className="exp-head cursor-pointer">さらに詳しく</summary>
          <RichText text={relabel(question.supplement)} className="mt-2 text-sm" />
        </details>
      ) : null}
    </div>
  );
}
