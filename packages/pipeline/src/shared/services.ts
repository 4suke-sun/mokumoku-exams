/**
 * 試験ガイドの対象サービスの名前から、本文に出るサービスを見つける(文字列の一致による目安)。
 * 出題計画の対象サービスの目標(事実カードの選び方)が使う。
 */

/** 正式名の先頭に付く接頭辞。本文では省かれることが多い */
const PREFIXES = ["Amazon ", "AWS "] as const;

function stripPrefix(name: string): string {
  for (const p of PREFIXES) if (name.startsWith(p)) return name.slice(p.length);
  return name;
}

/**
 * サービスの正式名から、本文での呼び方の候補を作る。括弧の外の名前と、括弧の中の略称のそれぞれについて、
 * 接頭辞のある形とない形を返す(例: 「Amazon Simple Queue Service (Amazon SQS)」から「SQS」など)。
 */
export function serviceAliases(name: string): string[] {
  const trimmed = name.trim();
  const match = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(trimmed);
  const parts = match ? [match[1] ?? "", match[2] ?? ""] : [trimmed];
  const aliases = parts.flatMap((p) => [p.trim(), stripPrefix(p.trim())]).filter((a) => a.length > 0);
  return [...new Set(aliases)];
}

/** 英数字の境目の判定。前後が英数字なら、別の語の一部とみなす */
const WORD = /[A-Za-z0-9]/;

/**
 * 本文に出るサービスの正式名を返す(1 つの本文で、同じサービスは 1 回だけ)。長い呼び方から先に当て、
 * 当てた範囲は短い呼び方に使わない(「CloudWatch Logs」を当てた所で、「CloudWatch」を重ねて数えない)。
 * 大文字小文字は区別する。
 */
export function mentionedServices(text: string, services: readonly string[]): Set<string> {
  const candidates = services
    .flatMap((service) => serviceAliases(service).map((alias) => ({ service, alias })))
    .sort((a, b) => b.alias.length - a.alias.length || (a.alias < b.alias ? -1 : a.alias > b.alias ? 1 : 0));
  const used = new Array<boolean>(text.length).fill(false);
  const found = new Set<string>();
  for (const { service, alias } of candidates) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(alias, from);
      if (at < 0) break;
      from = at + 1;
      const end = at + alias.length;
      if (WORD.test(text[at - 1] ?? "") || WORD.test(text[end] ?? "")) continue;
      if (used.slice(at, end).some(Boolean)) continue;
      used.fill(true, at, end);
      found.add(service);
    }
  }
  return found;
}

/** 本文の並びごとに、出るサービスを数える(1 つの本文で、同じサービスは 1 回) */
export function countServices(texts: readonly string[], services: readonly string[]): Map<string, number> {
  const counts = new Map<string, number>(services.map((s) => [s, 0]));
  for (const text of texts) {
    for (const s of mentionedServices(text, services)) counts.set(s, (counts.get(s) ?? 0) + 1);
  }
  return counts;
}
