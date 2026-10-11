import type { MetadataRoute } from "next";
import { APP_BACKGROUND_COLOR, THEME_COLORS } from "@/lib/pwa.ts";

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
    background_color: APP_BACKGROUND_COLOR,
    // マニフェストの色は 1 つだけ持てるので、ライトの色にする(ページを開いたあとは、layout の themeColor が端末の設定に合わせる)
    theme_color: THEME_COLORS.light,
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      // 淡い背景の上に、余白を取ってマスコットを置いているので、丸などに切り抜かれても欠けない
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
