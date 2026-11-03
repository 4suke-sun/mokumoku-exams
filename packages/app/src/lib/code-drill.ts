import { normalizeCode } from "@mokumoku-exams/data-schema/code-drill-data/normalize";
import type { CodeDrillOutcome, CodeDrillProblem } from "@mokumoku-exams/data-schema/code-drill-data/schema";
import { shuffle } from "./quiz.ts";

// コードドリルの穴埋め・全文入力・ヒント・判定。画面から切り離した純粋な関数(docs/app/specs/code-drill.md)。

/** 穴埋めの断片。`id` は断片ごとに一意(同じ文の断片が 2 つあっても区別する) */
export type Fragment = { id: string; text: string };

/** 穴埋めの状態: 穴ごとに入れた断片の ID(空は null)と、ヒントで埋めた穴か */
export type FillState = { placed: (string | null)[]; hinted: boolean[] };

/** 断片の一覧(正解の断片と誤りの断片)。並びは `random` で入れ替える */
export function fragmentsOf(problem: CodeDrillProblem, random: () => number): Fragment[] {
  return shuffle(
    [
      ...problem.blanks.map((blank, i) => ({ id: `b${i + 1}`, text: blank.answer })),
      ...problem.distractors.map((d, i) => ({ id: `d${i + 1}`, text: d.text })),
    ],
    random,
  );
}

export function emptyFill(problem: CodeDrillProblem): FillState {
  return { placed: problem.blanks.map(() => null), hinted: problem.blanks.map(() => false) };
}

/** 断片を、先頭の空いた穴に入れる。使った断片と、空いた穴がないときは、そのまま */
export function placeFragment(state: FillState, fragmentId: string): FillState {
  if (state.placed.includes(fragmentId)) return state;
  const index = state.placed.indexOf(null);
  if (index < 0) return state;
  const placed = [...state.placed];
  placed[index] = fragmentId;
  return { ...state, placed };
}

/** 穴から断片を外す。ヒントで埋めた穴は外せない */
export function removeFragment(state: FillState, index: number): FillState {
  if (state.hinted[index] || state.placed[index] === null) return state;
  const placed = [...state.placed];
  placed[index] = null;
  return { ...state, placed };
}

/** すべての穴を空にする(ヒントで埋めた穴は残す) */
export function clearFill(state: FillState): FillState {
  return { ...state, placed: state.placed.map((id, i) => (state.hinted[i] ? id : null)) };
}

const textOf = (fragments: readonly Fragment[], id: string | null) => fragments.find((f) => f.id === id)?.text;

/** 穴に正解の断片が入っているか */
export function blankIsCorrect(problem: CodeDrillProblem, fragments: readonly Fragment[], state: FillState, i: number) {
  return textOf(fragments, state.placed[i] ?? null) === problem.blanks[i]?.answer;
}

/**
 * 穴埋めのヒント: 先頭から見て、まだヒントで明かしていない穴のうち最初の穴に、正解の断片を入れて、外せない印を付ける
 * (入っていた断片は外れる。すでに正解の断片が入っていても、同じく印を付ける。押せるかどうかで正誤が分からないように)。
 * 正解の断片がほかの穴に正しくなく入っていれば、そこから移す。明かせる穴がなければ、そのまま。
 */
export function hintFill(problem: CodeDrillProblem, fragments: readonly Fragment[], state: FillState): FillState {
  const index = state.hinted.findIndex((hinted) => !hinted);
  if (index < 0) return state;
  if (blankIsCorrect(problem, fragments, state, index)) {
    const hinted = [...state.hinted];
    hinted[index] = true;
    return { ...state, hinted };
  }
  const answer = problem.blanks[index]?.answer;
  const candidates = fragments.filter((f) => f.text === answer);
  const unused = candidates.find((f) => !state.placed.includes(f.id));
  const movable = candidates.find((f) => {
    const at = state.placed.indexOf(f.id);
    return at >= 0 && !blankIsCorrect(problem, fragments, state, at);
  });
  const fragment = unused ?? movable;
  if (!fragment) return state;
  const placed = state.placed.map((id) => (id === fragment.id ? null : id));
  placed[index] = fragment.id;
  const hinted = [...state.hinted];
  hinted[index] = true;
  return { placed, hinted };
}

/** すべての穴が埋まったか(埋まるまで「回答する」は押せない) */
export const fillComplete = (state: FillState) => state.placed.every((id) => id !== null);

/** 穴ごとの採点。誤りの穴は、入れた断片の「実行するとどうなるか」(その穴を狙った誤りの断片だけ)を返す */
export function gradeFill(
  problem: CodeDrillProblem,
  fragments: readonly Fragment[],
  state: FillState,
): { correct: boolean; blanks: { correct: boolean; text: string; outcome: CodeDrillOutcome | null }[] } {
  const blanks = problem.blanks.map((_, i) => {
    const text = textOf(fragments, state.placed[i] ?? null) ?? "";
    const correct = blankIsCorrect(problem, fragments, state, i);
    const outcome = correct
      ? null
      : (problem.distractors.find((d) => d.blank === i + 1 && d.text === text)?.outcome ?? null);
    return { correct, text, outcome };
  });
  return { correct: blanks.every((b) => b.correct), blanks };
}

/** 全文入力の判定: 正規化した入力が、正解か別解のどれかと完全一致すれば正解。よくある誤りと一致したら、その番号を返す */
export function judgeCode(problem: CodeDrillProblem, input: string): { correct: boolean; mistake: number | null } {
  const normalized = normalizeCode(problem.language, input);
  if (problem.solutions.some((s) => normalizeCode(problem.language, s) === normalized)) {
    return { correct: true, mistake: null };
  }
  const mistake = (problem.mistakes ?? []).findIndex((m) => normalizeCode(problem.language, m.code) === normalized);
  return { correct: false, mistake: mistake < 0 ? null : mistake };
}

/** 全文入力のヒントで明かせる段階の数: 1 回目は穴のあるコード(穴は伏せ字)、2 回目からは穴を 1 つずつ */
export const textHintSteps = (problem: CodeDrillProblem) => problem.blanks.length + 1;

/** 全文入力のヒントの表示。`level` 回押したあとのコード(0 は何も出さない)。伏せた穴は `［穴 n］` */
export function textHint(problem: CodeDrillProblem, level: number): string | null {
  if (level <= 0) return null;
  const revealed = Math.min(level - 1, problem.blanks.length);
  return problem.template.replace(/\{\{(\d+)\}\}/g, (_, n) => {
    const i = Number(n) - 1;
    return i < revealed ? (problem.blanks[i]?.answer ?? "") : `［穴 ${n}］`;
  });
}

/** 穴のあるコードを、文字の部分と穴に分ける(画面で穴をボタンにするため) */
export function templateParts(template: string): ({ kind: "code"; text: string } | { kind: "blank"; index: number })[] {
  const parts: ({ kind: "code"; text: string } | { kind: "blank"; index: number })[] = [];
  let last = 0;
  for (const match of template.matchAll(/\{\{(\d+)\}\}/g)) {
    if (match.index > last) parts.push({ kind: "code", text: template.slice(last, match.index) });
    parts.push({ kind: "blank", index: Number(match[1]) - 1 });
    last = match.index + match[0].length;
  }
  if (last < template.length) parts.push({ kind: "code", text: template.slice(last) });
  return parts;
}
