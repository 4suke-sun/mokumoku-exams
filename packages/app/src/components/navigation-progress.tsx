"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { startsNavigation } from "@/lib/progress.ts";
import { LoadingBadge } from "./loading-badge.tsx";

// 遷移が終わらないときでも、バーが出たままにならないようにする上限
const MAX_MS = 10_000;

export function NavigationProgress() {
  const pathname = usePathname();
  const [active, setActive] = useState(false);

  useEffect(() => {
    function onClick(event: MouseEvent) {
      const a = (event.target as Element | null)?.closest("a");
      if (a && startsNavigation(a, event, new URL(window.location.href))) setActive(true);
    }
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 遷移先に着いたら終わりにする
  useEffect(() => {
    setActive(false);
  }, [pathname]);

  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setActive(false), MAX_MS);
    return () => clearTimeout(timer);
  }, [active]);

  return (
    <>
      {active ? (
        <div role="progressbar" aria-label="ページを読み込んでいます" className="nav-progress">
          <div className="nav-progress-fill" />
        </div>
      ) : null}
      <LoadingBadge active={active} />
    </>
  );
}
