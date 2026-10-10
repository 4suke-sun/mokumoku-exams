"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { startsNavigation } from "@/lib/progress.ts";

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

  if (!active) return null;
  return (
    <div role="progressbar" aria-label="ページを読み込んでいます" className="fixed inset-x-0 top-0 z-50 h-1 bg-line">
      <div className="progress-bar h-full bg-primary" />
    </div>
  );
}
