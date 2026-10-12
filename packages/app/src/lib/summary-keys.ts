// 要約カードの画面のキー操作。出題の画面(lib/keyboard.ts)と、前へ(P)・次へ(N)を同じにする。
// この画面には、ラジオボタンも入力欄もないので、矢印キーも使える。

export type SummaryKeyAction = "next" | "previous" | "toggle";

type KeyInfo = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  /** キーを受け取った要素の種類(`button`・`a` は Enter を自分で処理し、`input` などは入力にまかせる) */
  targetTag: string;
};

const NEXT_KEYS = new Set(["n", "N", "ArrowRight"]);
const PREVIOUS_KEYS = new Set(["p", "P", "ArrowLeft"]);
const TEXT_TARGETS = new Set(["INPUT", "TEXTAREA", "SELECT"]);
const SELF_HANDLED_ENTER = new Set(["BUTTON", "A", "SUMMARY"]);

/**
 * キーの入力を、動作に変える。対応しないキーは null。
 * - N か → で次へ、P か ← で前へ(最後の次は最初、最初の前は最後。巡回する)
 * - A か Enter で、答えの開閉。ボタンやリンクにフォーカスがあるときの Enter は、その操作にまかせる
 * - 修飾キー(Ctrl、Cmd、Alt)つきは、ブラウザや支援技術の操作なので扱わない
 * - 入力欄にフォーカスがあるときは、入力にまかせる
 */
export function summaryKeyAction(event: KeyInfo): SummaryKeyAction | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const tag = event.targetTag.toUpperCase();
  if (TEXT_TARGETS.has(tag)) return null;
  if (NEXT_KEYS.has(event.key)) return "next";
  if (PREVIOUS_KEYS.has(event.key)) return "previous";
  if (event.key === "a" || event.key === "A") return "toggle";
  if (event.key === "Enter" && !SELF_HANDLED_ENTER.has(tag)) return "toggle";
  return null;
}

/** 巡回した、隣のカードの番号。`count` が 0 のときは 0。 */
export function stepIndex(index: number, count: number, step: 1 | -1): number {
  return count === 0 ? 0 : (index + step + count) % count;
}
