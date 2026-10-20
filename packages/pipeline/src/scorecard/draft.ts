import { type Draft, isChoiceDraft } from "../draft/schema.ts";
import { resolveProfile } from "./profiles.ts";
import { type QuestionItem, questionPasses, scoreQuestion } from "./score.ts";

/** 点数票の項目が指す場所。設問文に関わる項目は questionText、選択肢に関わる項目は choices */
const PATH: Record<QuestionItem, "questionText" | "choices"> = {
  A1: "questionText",
  A2: "questionText",
  A3: "choices",
  A4: "choices",
  A5: "choices",
  A6: "questionText",
  A7: "choices",
  A8: "choices",
  A9: "choices",
  A10: "choices",
  B1: "questionText",
  B2: "questionText",
  B3: "questionText",
  B4: "choices",
  B5: "questionText",
  B6: "questionText",
  B7: "questionText",
};

/**
 * 下書きの取り込みで、書き方の点数票を警告として報告する。重さは警告だけで、下書きは止めない。
 * 点数が合格点に届かないときだけ、減点された項目を `scorecard-<項目の ID>` の規則名と場所で返す(本文は含まない)。
 * 点数票の帯のない資格と、自由記述には、何も返さない。
 */
export function scorecardWarnings(draft: Draft, examCode: string): { rule: string; path: string }[] {
  const profile = resolveProfile(examCode);
  if (profile === null || !isChoiceDraft(draft)) return [];
  const score = scoreQuestion(
    {
      id: "draft",
      type: draft.questionType,
      stem: draft.questionText,
      choices: draft.choices.map((c) => c.text),
      correct: draft.correctAnswers.map((a) => draft.choices.findIndex((c) => c.key === a)),
    },
    profile,
  );
  if (questionPasses(score)) return [];
  return score.lost.map((item) => ({ rule: `scorecard-${item.toLowerCase()}`, path: PATH[item] }));
}
