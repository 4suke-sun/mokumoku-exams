import { Skeleton, Spinner } from "./skeleton.tsx";

// 画面の形に合わせた、読み込み中の表示(app の各 loading.tsx と、データを読み込む部品で使う)。
// 形は飾りなので読み上げず、読み込み中であることは、スピナーの文言で伝える。

/** 一覧の画面(資格の一覧、学習モードの単元、直前チェックなど) */
export function ListSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div className="space-y-6">
      <Spinner />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-4 w-3/4" />
      <div className="space-y-3">
        {Array.from({ length: rows }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: 形だけの並びで、入れ替わらない
          <div key={i} className="card space-y-2 p-4">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 結果の画面: 題、正答率のカード、問題ごとの結果 */
export function ResultSkeleton() {
  return (
    <div className="space-y-8">
      <Spinner />
      <div className="space-y-3">
        <Skeleton className="h-8 w-24" />
        <Skeleton className="h-4 w-1/2" />
        <div className="card flex flex-col items-center gap-5 p-5 sm:flex-row">
          <Skeleton className="size-36 shrink-0 rounded-full" />
          <div className="w-full space-y-2">
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </div>
      </div>
      <div className="space-y-4">
        <Skeleton className="h-6 w-40" />
        {[0, 1].map((i) => (
          <div key={i} className="card space-y-3 p-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-5/6" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 学習の状況の画面: 題、目標日、合格予測、数値のタイル */
export function DashboardSkeleton() {
  return (
    <div className="space-y-8">
      <Spinner />
      <div className="space-y-2">
        <Skeleton className="h-4 w-28" />
        <Skeleton className="h-8 w-40" />
      </div>
      <div className="card space-y-3 p-4">
        <Skeleton className="h-5 w-1/2" />
        <Skeleton className="h-10 w-48" />
      </div>
      <div className="card flex flex-col items-center gap-5 p-5 sm:flex-row">
        <Skeleton className="size-36 shrink-0 rounded-full" />
        <div className="w-full space-y-2">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-4 w-full" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card space-y-2 p-3">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-6 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** 管理の画面: ユーザーの一覧 */
export function AdminSkeleton() {
  return (
    <div className="space-y-8">
      <Spinner />
      <Skeleton className="h-8 w-32" />
      <div className="space-y-3">
        <Skeleton className="h-6 w-40" />
        <div className="card divide-y divide-line">
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center justify-between gap-3 p-3">
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-8 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** 出題の画面: 進み具合、問題文、選択肢 */
export function PlaySkeleton() {
  return (
    <div className="space-y-6">
      <Spinner />
      <div className="space-y-2">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-2 w-full rounded-full" />
      </div>
      <div className="space-y-3">
        <Skeleton className="h-6 w-full" />
        <Skeleton className="h-6 w-2/3" />
        {[0, 1, 2, 3].map((i) => (
          <Skeleton key={i} className="h-12 w-full rounded-md" />
        ))}
      </div>
    </div>
  );
}
