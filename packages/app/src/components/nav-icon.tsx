import type { NavIcon as NavIconName } from "@/lib/nav.ts";

// ナビゲーションのアイコン。線で描き、色は文字の色に従う。飾りなので読み上げず、項目の名前は文字で添える。
const PATHS: Record<NavIconName, string[]> = {
  home: ["M3 10.5 12 3l9 7.5", "M5 9.5V20h5v-6h4v6h5V9.5"],
  exams: ["M4 5h11a3 3 0 0 1 3 3v12H7a3 3 0 0 1-3-3V5Z", "M18 8h2v12", "M8 9h6", "M8 13h6"],
  bookmark: ["M6 3h12v18l-6-4.5L6 21V3Z"],
  help: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z", "M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6", "M12 17h.01"],
  release: ["M5 21V4h11l-1.5 4L16 12H5", "M5 4v17"],
  account: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z", "M4 21a8 8 0 0 1 16 0"],
  admin: ["M12 3 5 6v5c0 4.5 3 8.5 7 10 4-1.5 7-5.5 7-10V6l-7-3Z", "M9 12l2 2 4-4"],
  login: ["M14 4h5v16h-5", "M10 8l4 4-4 4", "M3 12h11"],
  menu: ["M4 7h16", "M4 12h16", "M4 17h16"],
  back: ["M15 5l-7 7 7 7"],
};

export function NavIcon({ name, className = "size-5" }: { name: NavIconName; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
    >
      {PATHS[name].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
