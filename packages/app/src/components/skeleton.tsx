export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded bg-line ${className}`} />;
}

export function Spinner({ label = "読み込んでいます" }: { label?: string }) {
  return (
    <output className="inline-flex items-center gap-2 text-muted">
      <span
        aria-hidden="true"
        className="inline-block size-4 animate-spin rounded-full border-2 border-line border-t-primary"
      />
      {label}
    </output>
  );
}
