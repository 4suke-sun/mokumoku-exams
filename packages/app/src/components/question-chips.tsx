import { domainColorIndex } from "@/lib/domain-color.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";

const DIFFICULTY: Record<NonNullable<Question["difficulty"]>, { label: string; tone: string }> = {
  easy: { label: "やさしい", tone: "tone-correct" },
  medium: { label: "ふつう", tone: "tone-orange" },
  hard: { label: "むずかしい", tone: "tone-incorrect" },
};

const TYPE_LABELS: Record<Question["questionType"], string> = {
  single: "単一選択",
  multiple: "複数選択",
  "free-text": "記述",
};

/** 分野の色のクラス(globals.css の tone-domain-*)。Tailwind が見つけられるよう、省略せずに書く */
const DOMAIN_TONES = [
  "tone-domain-1",
  "tone-domain-2",
  "tone-domain-3",
  "tone-domain-4",
  "tone-domain-5",
  "tone-domain-6",
];

/**
 * 問題の分野・難易度・種類のチップ。色だけに頼らず、文字で伝える(難易度は「難易度: 」を読み上げに添える)。
 * 難易度のない問題では、難易度のチップを出さない。
 */
export function QuestionChips({
  domains = [],
  question,
}: {
  domains?: PublishedExam["domains"];
  question: Pick<Question, "domain" | "questionType" | "difficulty">;
}) {
  const index = domainColorIndex(domains, question.domain);
  const domainName = domains.find((d) => d.code === question.domain)?.name;
  const difficulty = question.difficulty ? DIFFICULTY[question.difficulty] : null;
  return (
    <ul aria-label="問題の情報" className="flex flex-wrap gap-2">
      {domainName ? (
        <li className={`chip ${index === null ? "tone-muted" : DOMAIN_TONES[index]}`}>
          <span className="sr-only">分野: </span>
          {domainName}
        </li>
      ) : null}
      {difficulty ? (
        <li className={`chip ${difficulty.tone}`}>
          <span className="sr-only">難易度: </span>
          {difficulty.label}
        </li>
      ) : null}
      <li className="chip tone-muted">{TYPE_LABELS[question.questionType]}</li>
    </ul>
  );
}
