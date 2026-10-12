import type { SummaryFile } from "../../../../scripts/lib/summary-data/schema.ts";
import { loadQuestions } from "./exam-data.ts";
import type { PublishedExam, Question } from "./types.ts";

// リポジトリ直下の data/ の要約カード(静的な JSON)を読み、問題と合わせて、画面に渡す形にする。
// 形と、問題との一致は `npm run validate:data` が検査している。型だけを参照し、検査の処理は読み込まない。
// サーバー側(ビルド時を含む)だけで使う。

/** 画面に渡す要約カード。分野・難易度・選択肢の本文は、問題から引く */
export type SummaryCardView = {
  questionId: string;
  domain: string;
  difficulty?: Question["difficulty"];
  questionType: Question["questionType"];
  /** 問いの要約 */
  question: string;
  /** 正解の選択肢(キーと本文。問題の選択肢の並びで) */
  answers: { key: string; text: string }[];
  /** 決め手 */
  point: string;
};

/** カードと問題を合わせる。いまの問題データにない問題と、選択式でない問題のカードは、含めない(検査で落ちるため、通常は起きない)。 */
export function joinCards(file: Pick<SummaryFile, "cards">, questions: readonly Question[]): SummaryCardView[] {
  const byId = new Map(questions.map((q) => [q.questionId, q]));
  return file.cards.flatMap((card) => {
    const question = byId.get(card.questionId);
    if (!question || question.questionType === "free-text") return [];
    const answers = question.choices
      .filter((choice) => card.answers.includes(choice.key))
      .map((choice) => ({ key: choice.key, text: choice.text }));
    return [
      {
        questionId: card.questionId,
        domain: question.domain,
        ...(question.difficulty ? { difficulty: question.difficulty } : {}),
        questionType: question.questionType,
        question: card.question,
        answers,
        point: card.point,
      },
    ];
  });
}

/**
 * 公開中の資格の要約カードを読む。ファイル名は `summary.<資格コードの英小文字>.json`。
 * 要約カードは任意で、ファイルのない資格は null(入口を出さない)。
 */
export async function loadSummaryCards(exam: PublishedExam): Promise<SummaryCardView[] | null> {
  try {
    const file = (await import(`../../../../data/summary.${exam.examCode.toLowerCase()}.json`)) as {
      default: SummaryFile;
    };
    return joinCards(file.default, await loadQuestions(exam));
  } catch {
    return null;
  }
}
