// 分野ごとの配色(docs/app/design-tone.md)。分野の見分けに使い、同じ分野には、すべての画面で同じ色を使う。
// 色の値は globals.css の `--domain-1`〜`--domain-6`(ライトとダークの組)。文字の色に使えるコントラストにする。

/** 用意する色の数。分野がこれより多い資格では、先頭の色から繰り返す */
export const DOMAIN_COLOR_COUNT = 6;

/** 分野の色のクラス。Tailwind が見つけられるように、クラス名は省略せずに書く */
const DOMAIN_CLASSES = [
  { text: "text-domain-1", border: "border-l-domain-1", bar: "bg-domain-1" },
  { text: "text-domain-2", border: "border-l-domain-2", bar: "bg-domain-2" },
  { text: "text-domain-3", border: "border-l-domain-3", bar: "bg-domain-3" },
  { text: "text-domain-4", border: "border-l-domain-4", bar: "bg-domain-4" },
  { text: "text-domain-5", border: "border-l-domain-5", bar: "bg-domain-5" },
  { text: "text-domain-6", border: "border-l-domain-6", bar: "bg-domain-6" },
] as const;

export type DomainColorClasses = (typeof DOMAIN_CLASSES)[number];

/**
 * 分野の色の番号(0 始まり)。資格マスタの分野の並び順で決める(問題データやスコアの並びには左右されない)。
 * マスタにない分野は null(色を付けない)。
 */
export function domainColorIndex(domains: readonly { code: string }[], code: string): number | null {
  const index = domains.findIndex((d) => d.code === code);
  return index < 0 ? null : index % DOMAIN_COLOR_COUNT;
}

/** 分野の色のクラス。マスタにない分野は null。 */
export function domainColorClasses(domains: readonly { code: string }[], code: string): DomainColorClasses | null {
  const index = domainColorIndex(domains, code);
  return index === null ? null : (DOMAIN_CLASSES[index] ?? null);
}
