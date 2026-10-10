import { Skeleton, Spinner } from "@/components/skeleton.tsx";

export default function Loading() {
  return (
    <div className="space-y-4">
      <Spinner />
      <Skeleton className="h-8 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-3/4" />
    </div>
  );
}
