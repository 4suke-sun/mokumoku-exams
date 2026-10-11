import type { MetadataRoute } from "next";
import { THEME_COLOR } from "@/lib/pwa.ts";

// ホーム画面に追加したときの表示(PWA のマニフェスト)。ブラウザは Cookie なしで取りに来るため、ログインなしで取れる。
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "もくもく問題集",
    short_name: "もくもく",
    description: "クラウド資格の学習用に、問題を解き、間違いを復習できます。",
    lang: "ja",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: THEME_COLOR,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon.svg", sizes: "any", type: "image/svg+xml" },
    ],
  };
}
