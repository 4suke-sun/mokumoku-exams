/**
 * robots.txt の解釈(RFC 9309 の範囲)。自分の User-Agent の製品名に合う組があればそれを、なければ `*` の組を使う。
 * Allow と Disallow は、最も長く一致した規則を採り、同じ長さなら Allow を採る。`*` と行末の `$` を扱う。
 */
export interface RobotsRules {
  allow: string[];
  disallow: string[];
}

interface Group {
  agents: string[];
  rules: RobotsRules;
}

function parseGroups(text: string): Group[] {
  const groups: Group[] = [];
  let current: Group | null = null;
  let lastWasAgent = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line);
    if (!m) continue;
    const field = (m[1] ?? "").toLowerCase();
    const value = (m[2] ?? "").trim();
    if (field === "user-agent") {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: { allow: [], disallow: [] } };
        groups.push(current);
      }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;
    if (!current) continue;
    if (field === "allow" && value !== "") current.rules.allow.push(value);
    if (field === "disallow" && value !== "") current.rules.disallow.push(value);
  }
  return groups;
}

/** 製品名(User-Agent の最初の語の `/` より前)に合う組の規則。なければ `*` の組。どちらもなければ制限なし */
export function rulesFor(text: string, userAgent: string): RobotsRules {
  const product = (userAgent.split(/[\s/]/)[0] ?? "").toLowerCase();
  const groups = parseGroups(text);
  const pick = (match: (agent: string) => boolean) => {
    const matched = groups.filter((g) => g.agents.some(match));
    if (matched.length === 0) return null;
    return {
      allow: matched.flatMap((g) => g.rules.allow),
      disallow: matched.flatMap((g) => g.rules.disallow),
    };
  };
  return pick((a) => a !== "*" && a === product) ?? pick((a) => a === "*") ?? { allow: [], disallow: [] };
}

function patternLength(pattern: string): number {
  return pattern.replace(/\$$/, "").length;
}

function matches(pattern: string, path: string): boolean {
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const re = body
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${re}${anchored ? "$" : ""}`).test(path);
}

/** パス(クエリを含む)を取得してよいか */
export function isAllowed(rules: RobotsRules, pathWithQuery: string): boolean {
  if (pathWithQuery === "/robots.txt") return true;
  let best: { length: number; allow: boolean } | null = null;
  for (const [list, allow] of [
    [rules.allow, true],
    [rules.disallow, false],
  ] as const) {
    for (const pattern of list) {
      if (!matches(pattern, pathWithQuery)) continue;
      const length = patternLength(pattern);
      if (!best || length > best.length || (length === best.length && allow)) best = { length, allow };
    }
  }
  return best?.allow ?? true;
}
