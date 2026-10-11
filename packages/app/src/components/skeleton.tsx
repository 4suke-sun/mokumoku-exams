/** 読み込み中の形だけを示す面。光が横に流れる(動きを減らす設定とシンプル表示では止まる)。 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`skeleton ${className}`} />;
}

type SpinnerProps = {
  /** 読み上げと画面に出す文言 */
  label?: string;
  /** 文言を画面に出さず、読み上げだけにする */
  hideLabel?: boolean;
  /** リングの大きさ(Tailwind の size-*) */
  className?: string;
};

/**
 * 二重リングのスピナー。動きを減らす設定では回らないので、文言を必ず添える(画面に出さないときも読み上げる)。
 */
export function Spinner({ label = "読み込んでいます", hideLabel = false, className = "size-5" }: SpinnerProps) {
  return (
    <output className="inline-flex items-center gap-2 text-muted">
      <span aria-hidden="true" className={`spinner ${className}`} />
      <span className={hideLabel ? "sr-only" : undefined}>{label}</span>
    </output>
  );
}
