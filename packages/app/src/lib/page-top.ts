/** フォーカスを移せる要素(テストで差し替えられるよう、必要な形だけにする) */
type Focusable = Pick<HTMLElement, "focus">;

/** ページの先頭へ戻せる窓(テストで差し替えられるよう、必要な形だけにする) */
type Scrollable = Pick<Window, "scrollTo">;

/**
 * 次の問題へ進んだときに、ページの先頭へ戻してから、設問へフォーカスを移す。
 * フォーカスだけだと、ブラウザは設問が見える最小の量しか動かさず、前の問題の解説を読んだ位置に近いまま残るため。
 * フォーカスは `preventScroll` で、先頭へ戻した位置を動かさない。
 */
export function showFromTop(target: Focusable | null, view: Scrollable = window): void {
  view.scrollTo({ top: 0, left: 0 });
  target?.focus({ preventScroll: true });
}
