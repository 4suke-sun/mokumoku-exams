"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { PAGE_WIDTH_CLASSES, pageWidth } from "@/lib/nav.ts";

/** 本文の枠。画面の用途(読む・学ぶ・広い)で、最大の幅を変える。スキップリンクの移動先(main#main)。 */
export function PageMain({ children }: { children: ReactNode }) {
  const width = PAGE_WIDTH_CLASSES[pageWidth(usePathname())];
  return (
    <main id="main" tabIndex={-1} className={`mx-auto w-full px-4 py-8 ${width}`}>
      {children}
    </main>
  );
}

/** 本文の下の注記。本文と同じ幅にそろえ、狭い画面では下のドックに隠れないよう、余白を取る */
export function PageFooter({ children }: { children: ReactNode }) {
  const width = PAGE_WIDTH_CLASSES[pageWidth(usePathname())];
  return <footer className={`mx-auto w-full px-4 pb-28 text-sm text-muted lg:pb-8 ${width}`}>{children}</footer>;
}
