/**
 * 取得した HTML から、決定的に取り出せる手がかりだけを読む(リンク、更新日、廃止の兆候)。
 * 取り出した値は、ログや報告に出さない。
 */

/** a 要素の href を、基準の URL で絶対の URL にして返す。フラグメントは落とす */
export function extractLinks(html: string, base: string): string[] {
  const links = new Set<string>();
  for (const m of html.matchAll(/<a\b[^>]*?\bhref\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const href = (m[1] ?? m[2] ?? m[3] ?? "").trim();
    if (href === "" || /^(javascript|mailto|data):/i.test(href)) continue;
    try {
      const url = new URL(href.replace(/&amp;/g, "&"), base);
      url.hash = "";
      links.add(url.toString());
    } catch {
      // URL の形でないものは無視する
    }
  }
  return [...links];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

function decodeEntities(text: string): string {
  return text.replace(/&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi, (whole, dec, hex, name) => {
    const code = dec !== undefined ? Number(dec) : hex !== undefined ? Number.parseInt(hex, 16) : null;
    if (code !== null) return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    return ENTITIES[String(name).toLowerCase()] ?? whole;
  });
}

/** ページの `<title>`(実体参照を戻し、空白をそろえたもの)。なければ null。長さと形の検査は、使う側で行う。 */
export function extractTitle(html: string): string | null {
  const m = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const text = m?.[1] === undefined ? "" : decodeEntities(m[1]).replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

function toIsoDate(value: string): string | null {
  const t = Date.parse(value);
  if (Number.isNaN(t)) return null;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * 出典が示す更新日(YYYY-MM-DD)。meta の更新日時、time 要素、Last-Modified ヘッダーの順に探す。取れなければ null。
 */
export function extractUpdatedDate(html: string, lastModifiedHeader: string | null): string | null {
  const patterns = [
    /<meta\b[^>]*\b(?:property|name)\s*=\s*["'](?:article:modified_time|og:updated_time|last-modified|dcterms\.modified)["'][^>]*\bcontent\s*=\s*["']([^"']+)["']/i,
    /<meta\b[^>]*\bcontent\s*=\s*["']([^"']+)["'][^>]*\b(?:property|name)\s*=\s*["'](?:article:modified_time|og:updated_time|last-modified|dcterms\.modified)["']/i,
    /<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    const date = m?.[1] ? toIsoDate(m[1]) : null;
    if (date) return date;
  }
  return lastModifiedHeader ? toIsoDate(lastModifiedHeader) : null;
}

/**
 * ページ自体が廃止・退役・保守の終了を示している兆候。機能の非推奨の記述のように、ページの中の一部の話題では反応しないよう、
 * ページ全体の状態を述べる言い回しだけを見る。
 */
const DEPRECATION_SIGNALS = [
  /\bthis (?:page|document|documentation|guide|content) (?:is|has been) (?:deprecated|archived|retired)\b/i,
  /\bthis (?:page|document|documentation|guide|content) is no longer (?:maintained|updated|supported)\b/i,
  /\bthis exam (?:has been|will be|is being) retired\b/i,
  /このページ(?:は|の内容は)(?:廃止|アーカイブ|更新を終了)/,
  /この試験は(?:廃止|提供を終了|終了)/,
];

export function hasDeprecationSignal(html: string): boolean {
  return DEPRECATION_SIGNALS.some((re) => re.test(html));
}
