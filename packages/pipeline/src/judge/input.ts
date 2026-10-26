import { sha256 } from "../collect/fetcher.ts";
import type { ChoiceDraft } from "../draft/schema.ts";
import type { ScoreInput } from "../scorecard/score.ts";

/**
 * 判定役に渡す問題 1 問の内容。公開している問題(data/questions.<コード>.json)と、評価用の変種(下書きから作る)の両方を、
 * この形にそろえる。判定役は、設問文・選択肢・正解・解説だけを読む(出典の節は渡さない。ADR 0021)。
 */
export interface JudgeInput {
  questionId: string;
  kind: "single" | "multiple";
  questionText: string;
  choices: { key: string; text: string }[];
  correctAnswers: string[];
  explanation: string;
}

/** 公開している問題から、判定の入力を作る。自由記述は判定しない(null) */
export function inputFromQuestion(q: {
  questionId: string;
  questionType: string;
  questionText: string;
  explanation: string;
  choices?: readonly { key: string; text: string }[];
  correctAnswers?: readonly string[];
}): JudgeInput | null {
  if (q.questionType !== "single" && q.questionType !== "multiple") return null;
  return {
    questionId: q.questionId,
    kind: q.questionType,
    questionText: q.questionText,
    choices: (q.choices ?? []).map((c) => ({ key: c.key, text: c.text })),
    correctAnswers: [...(q.correctAnswers ?? [])],
    explanation: q.explanation,
  };
}

/** 内容のハッシュ。問題が変わったかを確かめる */
export function contentHash(input: JudgeInput): string {
  return sha256(
    Buffer.from(
      JSON.stringify([
        input.questionId,
        input.kind,
        input.questionText,
        input.choices.map((c) => [c.key, c.text]),
        [...input.correctAnswers].sort(),
        input.explanation,
      ]),
    ),
  );
}

/** 点数票に渡す形 */
export function toScoreInput(input: JudgeInput): ScoreInput {
  return {
    id: input.questionId,
    type: input.kind,
    stem: input.questionText,
    choices: input.choices.map((c) => c.text),
    correct: input.correctAnswers.map((a) => input.choices.findIndex((c) => c.key === a)),
  };
}

/** 下書きから、判定の入力を作る。ID は呼び出し側が決める */
export function inputFromDraft(questionId: string, draft: ChoiceDraft): JudgeInput {
  return {
    questionId,
    kind: draft.questionType,
    questionText: draft.questionText,
    choices: draft.choices.map((c) => ({ key: c.key, text: c.text })),
    correctAnswers: [...draft.correctAnswers],
    explanation: draft.explanation,
  };
}

/** 指摘できる場所(設問文、解説、選択肢ごと) */
export function locationsOf(input: JudgeInput): string[] {
  return ["questionText", "explanation", ...input.choices.map((c) => `choices.${c.key}`)];
}
