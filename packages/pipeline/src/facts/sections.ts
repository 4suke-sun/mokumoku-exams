import { normalize } from "../text.ts";

/**
 * HTML の見出しで本文を節に分ける。アンカー(見出しの ID または見出しの文)で、照合する本文の範囲を絞るために使う。
 * 節は、見出しの直後から、同じ深さか、それより上の見出しの直前まで。
 */

export interface Section {
  id: string | null;
  /** 見出しに付いた ID のすべて(見出し自身の ID と、見出しの中のリンクの ID) */
  ids: string[];
  title: string;
  level: number;
  /** 節の本文(タグを落とし、正規化したもの) */
  text: string;
}

const HEADING = /<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi;
// 属性の名前が id か name そのもの(data-id などは含めない)。属性の前には空白がある。値は、引用符で囲んでも、囲まなくてもよい
const ID_ATTR = /(?:^|\s)(?:id|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i;
// 見出しの末尾の、リンクの印などに使われる幅のない文字
const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/g;

function attrId(attrs: string): string | null {
  const m = ID_ATTR.exec(attrs);
  return m ? (m[1] ?? m[2] ?? m[3] ?? null) : null;
}

/** 見出しの ID。見出し自身の ID と、見出しの中の最初のリンクの ID(どちらも、あれば) */
function headingIds(attrs: string, inner: string): string[] {
  const own = attrId(attrs);
  const nested = /<a\b[^>]*>/i.exec(inner);
  const nestedId = nested ? attrId(nested[0]) : null;
  return [own, nestedId].filter((id, i, all): id is string => id !== null && all.indexOf(id) === i);
}

function headingTitle(inner: string): string {
  return normalize(inner.replace(ZERO_WIDTH, ""));
}

export function parseSections(html: string): Section[] {
  const found = [...html.matchAll(HEADING)].map((m) => ({
    level: Number(m[1]),
    ids: headingIds(m[2] ?? "", m[3] ?? ""),
    title: headingTitle(m[3] ?? ""),
    start: m.index ?? 0,
    end: (m.index ?? 0) + m[0].length,
  }));
  return found.map((h, i) => {
    const next = found.slice(i + 1).find((n) => n.level <= h.level);
    return {
      id: h.ids[0] ?? null,
      ids: h.ids,
      title: h.title,
      level: h.level,
      text: normalize(html.slice(h.end, next ? next.start : html.length)),
    };
  });
}

/** アンカーの見出し(ID または見出しの文)に当たる節。なければ null */
export function findSection(html: string, heading: string): Section | null {
  const wanted = headingTitle(heading);
  const sections = parseSections(html);
  return sections.find((s) => s.ids.includes(heading)) ?? sections.find((s) => s.title === wanted) ?? null;
}
