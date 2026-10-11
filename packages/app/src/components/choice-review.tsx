import { InlineText } from "@/components/rich-text.tsx";
import type { ChoiceOrder } from "@/lib/quiz.ts";
import { displayLabels, orderChoices, relabelText } from "@/lib/quiz.ts";
import type { ChoiceQuestion } from "@/lib/types.ts";

export type ChoiceChipState = "plain" | "selected" | "correct" | "wrong";

/** 選択肢の記号の丸いチップ。読み上げでは、記号のあとに区切りを入れる */
export function ChoiceChip({ label, state = "plain" }: { label: string; state?: ChoiceChipState }) {
  return (
    <>
      <span className={`choice-chip choice-chip-${state}`}>{label}</span>
      <span className="sr-only">. </span>
    </>
  );
}

/**
 * 回答後の選択肢の一覧。正解は緑、自分の誤答は赤で示し、「正解」「あなたの回答」のタグを付ける(色だけに頼らない)。
 * 選択肢ごとの説明があれば、正解か不正解かの理由として添える。`selected` を渡さないときは、正解だけを示す。
 */
export function ChoiceReview({
  question,
  selected,
  choiceOrder,
}: {
  question: ChoiceQuestion;
  selected?: readonly string[];
  choiceOrder?: ChoiceOrder;
}) {
  const choices = orderChoices(question, choiceOrder);
  const labels = displayLabels(choices);
  return (
    <ul className="space-y-2 text-sm">
      {choices.map((choice) => {
        const isAnswer = question.correctAnswers.includes(choice.key);
        const chosen = selected?.includes(choice.key) ?? false;
        const state = isAnswer ? "correct" : chosen ? "wrong" : "plain";
        const label = labels.get(choice.key) ?? choice.key;
        return (
          <li
            key={choice.key}
            data-state={state}
            className={`flex items-start gap-3 rounded-md border p-3 ${
              isAnswer ? "border-correct bg-correct-bg" : chosen ? "border-incorrect bg-incorrect-bg" : "border-line"
            }`}
          >
            <ChoiceChip label={label} state={state} />
            <div className="min-w-0 flex-1 space-y-1">
              <p>
                <InlineText text={choice.text} />
              </p>
              {isAnswer || chosen ? (
                <p className="flex flex-wrap gap-2">
                  {isAnswer ? <span className="chip tone-correct">正解</span> : null}
                  {chosen ? (
                    <span className={`chip ${isAnswer ? "tone-primary" : "tone-incorrect"}`}>あなたの回答</span>
                  ) : null}
                </p>
              ) : null}
              {choice.explanation ? (
                <p className="text-muted">
                  <span className={`font-bold ${isAnswer ? "text-correct" : "text-incorrect"}`}>
                    {isAnswer ? "正解の理由: " : "不正解の理由: "}
                  </span>
                  <InlineText text={relabelText(choice.explanation, labels)} />
                </p>
              ) : null}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
