/**
 * PR の `Closes` の Issue と、マイルストーン・リリースノートの版の対応の検査。
 * 判定は副作用のない関数にして単体テストする(`gh` の呼び出しは scripts/check-pr-closes.ts)。
 * 報告は場所(Issue の番号など)と種類だけ。
 *
 * 版単位の PR は、`Closes` の Issue がすべて同じ版のマイルストーンで、その版のリリースノートがあり、
 * そのマイルストーンに `Closes` のほかの未完了の Issue が残らない。
 * `Closes` の Issue がどれもマイルストーンを持たない PR は、Issue 単位の PR(hotfix)として、検査しない。
 */

export interface PrClosesInput {
  /** PR の本文の `Closes` の Issue の番号 */
  closes: number[];
  /** `Closes` の各 Issue のマイルストーンの名前(ないときは null) */
  milestones: Record<number, string | null>;
  /** リリースノートの最新の版 */
  latestRelease: string | null;
  /** `Closes` のマイルストーンと同名のマイルストーン(なければ null)と、その未完了の Issue の番号 */
  milestone: { title: string; openIssues: number[] } | null;
}

/**
 * 本文の `Closes #番号` から、番号を取り出す。GitHub が Issue を閉じる語(close / fix / resolve の活用)に合わせ、
 * `Closes: #1`、箇条書き、1 行に複数も読む。コードブロックとインラインコードの中は読まない。
 */
export function parseCloses(body: string): number[] {
  const numbers: number[] = [];
  let inFence = false;
  for (const raw of body.split("\n")) {
    if (/^\s*(```|~~~)/.test(raw)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const line = raw.replace(/`[^`]*`/g, "");
    for (const m of line.matchAll(/\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?):?\s+#(\d+)\b/gi)) {
      numbers.push(Number(m[1]));
    }
  }
  return [...new Set(numbers)];
}

/** `Closes` の Issue のマイルストーンから、検査する版を決める。検査しないとき(Issue 単位の PR)は null。 */
export function targetVersion(input: Pick<PrClosesInput, "closes" | "milestones">): string | null {
  const titles = input.closes.map((n) => input.milestones[n] ?? null);
  return titles.some((t) => t !== null) ? (titles.find((t) => t !== null) ?? null) : null;
}

export function checkPrCloses(input: PrClosesInput): string[] {
  if (input.closes.length === 0) return [];
  const version = targetVersion(input);
  if (version === null) return [];

  const errors: string[] = [];
  const titles = new Set<string>();
  for (const n of input.closes) {
    const title = input.milestones[n] ?? null;
    if (title === null) errors.push(`Closes #${n}: マイルストーンがない(ほかの Issue は版のマイルストーンを持つ)`);
    else titles.add(title);
  }
  if (titles.size > 1) errors.push("Closes の Issue が、複数の版のマイルストーンにまたがる");
  if (titles.size !== 1) return errors;

  if (input.latestRelease !== version) {
    errors.push(`リリースノートの最新の版が、Closes のマイルストーン(${version})と違う`);
  }
  if (input.milestone === null) {
    errors.push(`マイルストーン ${version} が見つからない`);
    return errors;
  }
  const closing = new Set(input.closes);
  for (const n of input.milestone.openIssues) {
    if (!closing.has(n)) errors.push(`マイルストーン ${version} に、Closes にない未完了の Issue #${n} が残る`);
  }
  return errors;
}
