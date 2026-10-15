import { normalize } from "../text.ts";

/**
 * HTML の見出しで本文を節に分ける。アンカー(見出しの ID または見出しの文)で、照合する本文の範囲を絞るために使う。
 * 節は、見出しの直後から、同じ深さか、それより上の見出しの直前まで。
 */

export interface Section {
  id: string | null;
  title: string;
  level: number;
  /** 節の本文(タグを落とし、正規化したもの) */
  text: string;
}

const HEADING = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
// 属性の名前が id か name そのもの(data-id などは含めない)。属性の前には空白がある
const ID_ATTR = /(?:^|\s)(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)')/i;

function headingId(attrs: string, inner: string): string | null {
  const own = ID_ATTR.exec(attrs);
  if (own) return own[1] ?? own[2] ?? null;
  const nested = /<a\b[^>]*>/i.exec(inner);
  const nestedId = nested ? ID_ATTR.exec(nested[0]) : null;
  return nestedId ? (nestedId[1] ?? nestedId[2] ?? null) : null;
}

export function parseSections(html: string): Section[] {
  const found = [...html.matchAll(HEADING)].map((m) => ({
    level: Number(m[1]),
    id: headingId(m[2] ?? "", m[3] ?? ""),
    title: normalize(m[3] ?? ""),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  return found.map((h, i) => {
    const next = found.slice(i + 1).find((n) => n.level <= h.level);
    return {
      id: h.id,
      title: h.title,
      level: h.level,
      text: normalize(html.slice(h.end, next ? next.start : html.length)),
    };
  });
}

/** アンカーの見出し(ID または見出しの文)に当たる節。なければ null */
export function findSection(html: string, heading: string): Section | null {
  const wanted = normalize(heading);
  const sections = parseSections(html);
  return sections.find((s) => s.id === heading) ?? sections.find((s) => s.title === wanted) ?? null;
}
