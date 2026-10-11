import type { ReactNode } from "react";

// ページを開くたびに作り直される枠。開いたときのフェードを付ける(動きを減らす設定とシンプル表示では止まる)
export default function Template({ children }: { children: ReactNode }) {
  return <div className="motion-page">{children}</div>;
}
