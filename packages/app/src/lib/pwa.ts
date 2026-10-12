/**
 * ブラウザのバーなどの色。ページの背景と同じ色にして、画面となじませる(globals.css の `--bg` の、ライトとダーク。ライトの背景はホワイト)。
 * 端末の設定(ライト / ダーク)で出し分ける。
 */
export const THEME_COLORS = { light: "#ffffff", dark: "#12151a" } as const;

/** ホーム画面に追加したときの、起動中の背景の色(アイコンの淡い背景にそろえる) */
export const APP_BACKGROUND_COLOR = "#eaf1fc";
