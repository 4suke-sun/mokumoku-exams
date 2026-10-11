/** 出題画面のキー操作で起きる動作 */
export type QuizKeyAction = { type: "choose"; key: string } | { type: "next" } | { type: "previous" };

type KeyInfo = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** キーを受け取った要素の種類(`button` や `a` は、Enter を自分で処理する) */
  targetTag: string;
};

const NEXT_KEYS = new Set(["n", "N"]);
const PREVIOUS_KEYS = new Set(["p", "P"]);

/**
 * キーの入力を、出題画面の動作に変える。対応しないキーは null。
 *
 * - 選択肢のキー(A、B、…)で選ぶ。大文字と小文字は区別しない
 * - Enter または N で次へ(最後の問題では採点)、P で前へ
 * - 修飾キー(Ctrl、Cmd、Alt)つきは、ブラウザや支援技術の操作なので扱わない
 * - ボタンやリンクにフォーカスがあるときの Enter は、そのボタンやリンクの操作にまかせる
 * - 文章の入力欄(自由記述)にフォーカスがあるときは、どのキーも入力にまかせる
 *
 * 矢印キーは、ラジオボタンの標準の動き(選択の移動)にまかせるため、使わない。
 */
export function quizKeyAction(info: KeyInfo, choiceKeys: readonly string[]): QuizKeyAction | null {
  if (info.ctrlKey || info.metaKey || info.altKey) return null;
  if (info.targetTag.toLowerCase() === "textarea") return null;

  if (info.key === "Enter") {
    const tag = info.targetTag.toLowerCase();
    return tag === "button" || tag === "a" ? null : { type: "next" };
  }
  if (NEXT_KEYS.has(info.key)) return { type: "next" };
  if (PREVIOUS_KEYS.has(info.key)) return { type: "previous" };

  const upper = info.key.toUpperCase();
  if (info.key.length === 1 && choiceKeys.includes(upper)) return { type: "choose", key: upper };
  return null;
}
