"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { isActive, NAV_ITEMS } from "@/lib/nav.ts";
import { ThemeToggle } from "./theme-toggle.tsx";

export function SiteHeader() {
  const pathname = usePathname();
  const menuId = useId();
  const [open, setOpen] = useState(false);

  // biome-ignore lint/correctness/useExhaustiveDependencies: 遷移したらメニューを閉じる
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="text-lg font-bold text-fg hover:underline">
          もくもく問題集
        </Link>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={menuId}
          onClick={() => setOpen((v) => !v)}
          className="rounded-md border border-line px-3 py-1 text-sm md:hidden"
        >
          {open ? "閉じる" : "メニュー"}
        </button>
        <div className="hidden items-center gap-4 md:flex">
          <Nav pathname={pathname} />
          <ThemeToggle />
        </div>
      </div>
      {open ? (
        <div id={menuId} className="space-y-3 border-t border-line px-4 py-3 md:hidden">
          <Nav pathname={pathname} vertical />
          <ThemeToggle />
        </div>
      ) : null}
    </header>
  );
}

function Nav({ pathname, vertical = false }: { pathname: string; vertical?: boolean }) {
  return (
    <nav aria-label="主要メニュー">
      <ul className={vertical ? "space-y-2" : "flex items-center gap-4"}>
        {NAV_ITEMS.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <li key={item.href}>
              {item.ready ? (
                <Link
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={`text-sm hover:underline ${active ? "font-bold text-primary" : "text-fg"}`}
                >
                  {item.label}
                </Link>
              ) : (
                <span aria-disabled="true" className="text-sm text-muted">
                  {item.label}
                  <span className="ml-1 rounded border border-line px-1 text-xs">近日公開</span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
