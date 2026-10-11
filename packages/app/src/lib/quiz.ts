import { judgeFreeText } from "./free-text.ts";
import type { Session } from "./storage.ts";
import type { ChoiceQuestion, FreeTextQuestion, PublishedExam, Question } from "./types.ts";

type Choice = ChoiceQuestion["choices"][number];

/** 問題 ID ごとの、選んだ選択肢のキー */
export type Answers = Record<string, string[]>;

/** 問題 ID ごとの、自由記述の回答の文章 */
export type TextAnswers = Record<string, string>;

/** 採点に使う、問題の情報(択一・複数選択は正解、自由記述は採点基準) */
export type GradableQuestion =
  | Pick<ChoiceQuestion, "questionId" | "questionType" | "correctAnswers">
  | Pick<FreeTextQuestion, "questionId" | "questionType" | "rubric">;

export type Score = { total: number; correct: number; percent: number };

/** 問題 ID に対する回答を返す。回答がなければ空。継承されたプロパティ(`constructor` など)は回答として扱わない。 */
export function answerFor(answers: Answers, questionId: string): readonly string[] {
  return Object.hasOwn(answers, questionId) ? (answers[questionId] ?? []) : [];
}

/** 問題 ID に対する自由記述の回答を返す。回答がなければ空の文字列。 */
export function textAnswerFor(textAnswers: TextAnswers | undefined, questionId: string): string {
  return textAnswers && Object.hasOwn(textAnswers, questionId) ? (textAnswers[questionId] ?? "") : "";
}

/** 選んだ選択肢が、正解の集合と一致するか。順序は問わない。 */
export function isCorrect(question: Pick<ChoiceQuestion, "correctAnswers">, selected: readonly string[]): boolean {
  const chosen = new Set(selected);
  return chosen.size === question.correctAnswers.length && question.correctAnswers.every((key) => chosen.has(key));
}

/**
 * 問題の正誤。択一・複数選択は、選んだ選択肢が正解と一致するか。自由記述は、採点基準の判定で合格点以上か。
 * 未回答は不正解。画面の採点とサーバーの採点し直しの両方で、この関数を使う。
 */
export function isQuestionCorrect(
  question: GradableQuestion,
  answers: Answers,
  textAnswers: TextAnswers | undefined,
): boolean {
  if (question.questionType === "free-text") {
    return judgeFreeText(question.rubric, textAnswerFor(textAnswers, question.questionId)).passed;
  }
  return isCorrect(question, answerFor(answers, question.questionId));
}

/** Fisher-Yates。`random` は 0 以上 1 未満の値を返す関数(テストで固定できるように外から渡す)。 */
export function shuffle<T>(items: readonly T[], random: () => number): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    const a = result[i] as T;
    result[i] = result[j] as T;
    result[j] = a;
  }
  return result;
}

export type PickOptions = {
  /** 出題数。出題できる問題より多いときは、出題できる問題の数に切り詰める。 */
  count: number;
  /** 出題する分野のコード。空のときは、すべての分野。 */
  domains: readonly string[];
};

/** 条件に合う問題から、ランダムに `count` 問を選ぶ。 */
export function pickQuestions(all: readonly Question[], options: PickOptions, random: () => number): Question[] {
  const pool = options.domains.length === 0 ? all : all.filter((q) => options.domains.includes(q.domain));
  const count = Math.max(0, Math.min(options.count, pool.length));
  return shuffle(pool, random).slice(0, count);
}

/** 出題できる問題の数 */
export function countPool(all: readonly Question[], domains: readonly string[]): number {
  return domains.length === 0 ? all.length : all.filter((q) => domains.includes(q.domain)).length;
}

/** 正答数 ÷ 出題数 × 100(%)。未回答は不正解として数える。 */
export function score(questions: readonly GradableQuestion[], answers: Answers, textAnswers?: TextAnswers): Score {
  const total = questions.length;
  const correct = questions.filter((q) => isQuestionCorrect(q, answers, textAnswers)).length;
  const percent = total === 0 ? 0 : Math.round((correct / total) * 1000) / 10;
  return { total, correct, percent };
}

/** 合格ライン(%)。合格点を満点で割った割合。 */
export function passLinePercent(exam: Pick<PublishedExam, "passingScore" | "totalScore">): number {
  return Math.round((exam.passingScore / exam.totalScore) * 1000) / 10;
}

/** 選択肢のキーを、表示用の並び(A, B, …)にそろえる。 */
export function sortKeys(keys: readonly string[]): string[] {
  return [...keys].sort();
}

/** 問題 ID ごとの、選択肢のキーの並び */
export type ChoiceOrder = Record<string, string[]>;

/** 各問題の選択肢の並びをシャッフルして決める。 */
export function shuffleChoiceOrder(
  items: readonly { questionId: string; choiceKeys: readonly string[] }[],
  random: () => number,
): ChoiceOrder {
  const order: ChoiceOrder = {};
  for (const item of items) order[item.questionId] = shuffle(item.choiceKeys, random);
  return order;
}

/**
 * 出題を始めるときの状態を作る。問題は `items` の順に出題する。
 * `shuffleChoices` のときは、各問題の選択肢の並びをシャッフルして決める。
 */
export function newSession(
  examCode: string,
  items: readonly { questionId: string; choiceKeys: readonly string[] }[],
  options: { shuffleChoices: boolean },
  random: () => number,
  now: Date,
): Session {
  return {
    examCode,
    questionIds: items.map((item) => item.questionId),
    answers: {},
    index: 0,
    startedAt: now.toISOString(),
    choiceOrder: options.shuffleChoices ? shuffleChoiceOrder(items, random) : undefined,
  };
}

/**
 * 本番モードの出題の対象か。選択式(択一・複数選択)の問題だけで、自由記述は含めない。
 * データの検査も、本番の出題数を選択式の問題だけで数える。
 */
export function isOfficialTarget(item: { questionType: Question["questionType"] }): boolean {
  return item.questionType === "single" || item.questionType === "multiple";
}

/**
 * 本番モードの出題を始めるときの状態を作る。`items` のうち選択式の問題から、資格の本番の問題数をランダムに選び、
 * 開始の時刻から本番の制限時間後を締め切りにする。問題が足りないときは、ある分だけを出題する。
 */
export function newOfficialSession(
  exam: Pick<PublishedExam, "examCode" | "officialQuestionCount" | "officialTimeMinutes">,
  items: readonly { questionId: string; questionType: Question["questionType"]; choiceKeys: readonly string[] }[],
  options: { shuffleChoices: boolean },
  random: () => number,
  now: Date,
): Session {
  const picked = shuffle(items.filter(isOfficialTarget), random).slice(0, exam.officialQuestionCount);
  const session = newSession(exam.examCode, picked, options, random, now);
  const deadline = new Date(now.getTime() + exam.officialTimeMinutes * 60_000);
  return { ...session, deadline: deadline.toISOString() };
}

/** 締め切りまでの残り時間(ミリ秒)。過ぎていれば 0。締め切りの値が読めないときも 0(時間切れとして扱う)。 */
export function remainingMs(deadline: string, now: Date): number {
  const end = Date.parse(deadline);
  if (Number.isNaN(end)) return 0;
  return Math.max(0, end - now.getTime());
}

/** 残り時間を「分:秒」で表す。1 秒未満は切り上げる(0 秒の表示は、時間切れのときだけにする)。 */
export function formatRemaining(ms: number): string {
  const seconds = Math.ceil(Math.max(0, ms) / 1000);
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * 保存された並びで選択肢を返す。並びがない、または選択肢のキーと食い違うときは、元の並び。
 * 食い違いは、データが更新されたあとの古い保存を想定している。
 */
export function orderChoices(question: Pick<ChoiceQuestion, "questionId" | "choices">, order?: ChoiceOrder): Choice[] {
  const keys = order && Object.hasOwn(order, question.questionId) ? order[question.questionId] : undefined;
  if (!keys || keys.length !== question.choices.length) return question.choices;
  const byKey = new Map(question.choices.map((c) => [c.key, c]));
  const ordered = keys.map((k) => byKey.get(k));
  const valid = new Set(keys).size === keys.length && ordered.every((c) => c !== undefined);
  return valid ? (ordered as Choice[]) : question.choices;
}

/**
 * 表示用の記号。並べた順に、上から A, B, C, … を振る。元のキーから表示用の記号への対応を返す。
 * 正誤の判定と保存は元のキーで行い、表示だけをこの記号にする(シャッフルしても、記号は上から順に並ぶ)。
 */
export function displayLabels(choices: readonly Pick<Choice, "key">[]): Map<string, string> {
  return new Map(choices.map((choice, index) => [choice.key, String.fromCharCode(65 + index)]));
}

/** 表示用の記号から、元のキーへの対応(キー操作で、押された記号を元のキーに戻す) */
export function keyForLabel(labels: ReadonlyMap<string, string>, label: string): string | undefined {
  for (const [key, shown] of labels) if (shown === label) return key;
  return undefined;
}

/** 元のキーの並びを、表示用の記号にして、記号の順に並べる */
export function labelKeys(keys: readonly string[], labels: ReadonlyMap<string, string>): string[] {
  return sortKeys(keys.map((key) => labels.get(key) ?? key));
}

/**
 * 解説などの文章で、選択肢を記号で指している箇所(「選択肢B」「正解がBである」「（A）」など)を、表示用の記号に置き換える。
 * 前後が英数字につながる大文字(「AI」「S3」など)は、選択肢の記号ではないので置き換えない。並びが元のままなら、文章を変えない。
 */
export function relabelText(text: string, labels: ReadonlyMap<string, string>): string {
  if ([...labels].every(([key, shown]) => key === shown)) return text;
  return text.replace(/(?<![A-Za-z0-9])[A-Z](?![A-Za-z0-9])/g, (letter) => labels.get(letter) ?? letter);
}

/** 回答済みの問題数と、出題数。自由記述は、空白でない文章があれば回答済み。 */
export function sessionProgress(session: {
  questionIds: readonly string[];
  answers: Answers;
  textAnswers?: TextAnswers;
}): {
  answered: number;
  total: number;
} {
  const answered = session.questionIds.filter(
    (id) => answerFor(session.answers, id).length > 0 || hasText(textAnswerFor(session.textAnswers, id)),
  ).length;
  return { answered, total: session.questionIds.length };
}

/** 空白だけではない文章か(自由記述の回答があるか) */
export function hasText(value: string): boolean {
  return /\S/.test(value);
}

/** 分野ごとの出題できる問題数 */
export function domainCounts(pool: readonly { domain: string }[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of pool) counts[p.domain] = (counts[p.domain] ?? 0) + 1;
  return counts;
}

/** 分野を選んだ状態でモード選択を開く経路(学習の状況の、分野別の弱点から進む)。 */
export function domainSelectHref(examCode: string, domain: string): string {
  return `/exams/${examCode}?domain=${encodeURIComponent(domain)}`;
}

/** モード選択の問い合わせ(`?domain=`)で指定された分野。資格の分野でなければ、何も選ばない。 */
export function requestedDomains(search: string, codes: readonly string[]): string[] {
  const domain = new URLSearchParams(search).get("domain");
  return domain !== null && codes.includes(domain) ? [domain] : [];
}
