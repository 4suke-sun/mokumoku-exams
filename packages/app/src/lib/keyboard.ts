/** 出題画面のキー操作で起きる動作 */
export type QuizKeyAction =
  | { type: "choose"; key: string }
  | { type: "submit" }
  | { type: "next" }
  | { type: "previous" };

type KeyInfo = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** キーを受け取った要素の種類(`button` や `a` は、Enter を自分で処理する) */
  targetTag: string;
};

/**
 * 今の問題の段階。
 * - answering: 選んでいる途中(まとめて最後に採点する出題では、ずっとこの段階)
 * - checking: 1 問ごとに解答を表示する出題で、「回答する」の前
 * - checked: 1 問ごとに解答を表示する出題で、「回答する」のあと(選択は変えられない)
 */
export type QuizKeyPhase = "answering" | "checking" | "checked";

const NEXT_KEYS = new Set(["n", "N"]);
const PREVIOUS_KEYS = new Set(["p", "P"]);

/**
 * キーの入力を、出題画面の動作に変える。対応しないキーは null。
 *
 * - 選択肢の記号のキー(A、B、…。大文字と小文字は区別しない)か、数字のキー(1 が 1 番目)で選ぶ
 * - Enter で次へ(最後の問題では採点)。1 問ごとの出題の「回答する」の前は、Enter で回答する
 * - N で次へ(回答していなくても進む)、P で前へ
 * - 「回答する」のあとは、選択のキーを使わない(選択は変えられない)
 * - 修飾キー(Ctrl、Cmd、Alt)つきは、ブラウザや支援技術の操作なので扱わない
 * - ボタンやリンクにフォーカスがあるときの Enter は、そのボタンやリンクの操作にまかせる
 * - 文章の入力欄(自由記述)にフォーカスがあるときは、どのキーも入力にまかせる
 *
 * 矢印キーは、ラジオボタンの標準の動き(選択の移動)にまかせるため、使わない。
 */
export function quizKeyAction(
  info: KeyInfo,
  choiceKeys: readonly string[],
  phase: QuizKeyPhase = "answering",
): QuizKeyAction | null {
  if (info.ctrlKey || info.metaKey || info.altKey) return null;
  if (info.targetTag.toLowerCase() === "textarea") return null;

  if (info.key === "Enter") {
    const tag = info.targetTag.toLowerCase();
    if (tag === "button" || tag === "a") return null;
    return phase === "checking" ? { type: "submit" } : { type: "next" };
  }
  if (NEXT_KEYS.has(info.key)) return { type: "next" };
  if (PREVIOUS_KEYS.has(info.key)) return { type: "previous" };
  if (phase === "checked" || info.key.length !== 1) return null;

  if (/^[1-9]$/.test(info.key)) {
    const key = choiceKeys[Number(info.key) - 1];
    return key === undefined ? null : { type: "choose", key };
  }
  const upper = info.key.toUpperCase();
  if (choiceKeys.includes(upper)) return { type: "choose", key: upper };
  return null;
}
