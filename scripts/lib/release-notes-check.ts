/**
 * data/release-notes.json の検証と、リリースノートとタグ(vX.Y.Z)の 1:1 の対応の検査。
 * 純粋な関数にして単体テストする(読み込みと git の呼び出しは scripts/check-release-notes.ts)。
 * 報告には本文を載せず、場所(releases[i] など)と種類だけを返す。
 */

export interface ReleaseItem {
  type: string;
  text: string;
}

export interface Release {
  version: string;
  date: string;
  title: string;
  items: ReleaseItem[];
}

/** 項目の種類: feat(機能)、fix(修正)、docs(文書)、dev(開発者向け)。 */
export const ITEM_TYPES = ["feat", "fix", "docs", "dev"] as const;

// 先頭ゼロは認めない(v01.2.3 と v1.2.3 を別の版として扱ってしまうため)。桁数にも上限を付ける。
const VERSION = /^v(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})\.(0|[1-9]\d{0,5})$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isVersion(value: string): boolean {
  return VERSION.test(value);
}

/** vX.Y.Z を [X, Y, Z] にする。形式が違えば null。 */
export function parseVersion(value: string): [number, number, number] | null {
  const m = VERSION.exec(value);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** a が b より新しければ正、古ければ負、同じなら 0。 */
export function compareVersions(a: string, b: string): number {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) {
    const d = (x[i] ?? 0) - (y[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRealDate(value: string): boolean {
  if (!DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/**
 * release-notes.json の構造を検証する。返すのは、問題の場所と種類(本文は載せない)。
 * 新しい版が先頭で、版は重複せず、新しい順に並んでいること。
 */
export function validateReleaseNotes(data: unknown): string[] {
  const errors: string[] = [];
  if (!isRecord(data) || !Array.isArray(data.releases)) {
    return ["releases の配列がありません"];
  }
  if (data.releases.length === 0) errors.push("releases が空です");

  const seen = new Set<string>();
  let previous: string | null = null;
  data.releases.forEach((release: unknown, i: number) => {
    const at = `releases[${i}]`;
    if (!isRecord(release)) {
      errors.push(`${at}: オブジェクトではありません`);
      return;
    }
    const { version, date, title, items } = release;

    if (typeof version !== "string" || !isVersion(version)) {
      errors.push(`${at}.version: vX.Y.Z の形式ではありません`);
    } else {
      if (seen.has(version)) errors.push(`${at}.version: 版が重複しています`);
      seen.add(version);
      if (previous !== null && compareVersions(previous, version) <= 0) {
        errors.push(`${at}.version: 新しい順に並んでいません`);
      }
      previous = version;
    }
    if (typeof date !== "string" || !isRealDate(date)) {
      errors.push(`${at}.date: YYYY-MM-DD の実在する日付ではありません`);
    }
    if (typeof title !== "string" || title.trim() === "") {
      errors.push(`${at}.title: 空です`);
    }
    if (!Array.isArray(items) || items.length === 0) {
      errors.push(`${at}.items: 1 件以上の配列ではありません`);
      return;
    }
    items.forEach((item: unknown, j: number) => {
      const itemAt = `${at}.items[${j}]`;
      if (!isRecord(item)) {
        errors.push(`${itemAt}: オブジェクトではありません`);
        return;
      }
      if (typeof item.type !== "string" || !(ITEM_TYPES as readonly string[]).includes(item.type)) {
        errors.push(`${itemAt}.type: ${ITEM_TYPES.join(" / ")} のいずれかではありません`);
      }
      if (typeof item.text !== "string" || item.text.trim() === "") {
        errors.push(`${itemAt}.text: 空です`);
      }
    });
  });
  return errors;
}

/**
 * タグとの 1:1 の対応を検査する。
 * - `v` で始まるタグは、vX.Y.Z の形式にする(それ以外の `v` 始まりは、形式の誤りとして止める。`v` 以外で始まるタグは対象外)
 * - すべてのタグに、対応するリリースノートのエントリがある
 * - 最新のエントリ以外は、すべてタグがある(最新のエントリは、タグを切る前でもよい)
 */
export function checkTagCorrespondence(releases: Release[], tags: string[]): string[] {
  const errors: string[] = [];
  const versions = new Set(releases.map((r) => r.version));
  const tagSet = new Set(tags.filter(isVersion));

  for (const tag of tags.filter((t) => t.startsWith("v") && !isVersion(t))) {
    errors.push(`タグ ${tag} は vX.Y.Z の形式ではありません`);
  }
  for (const tag of [...tagSet].sort(compareVersions)) {
    if (!versions.has(tag)) errors.push(`タグ ${tag} に対応するリリースノートのエントリがありません`);
  }
  releases.forEach((release, i) => {
    if (i > 0 && !tagSet.has(release.version)) {
      errors.push(`リリースノートの ${release.version} に対応するタグがありません`);
    }
  });
  return errors;
}

/** タグを切るときの検査: そのタグに対応するエントリがあること。 */
export function checkTagHasEntry(releases: Release[], tag: string): string[] {
  if (!isVersion(tag)) return [`タグ ${tag} は vX.Y.Z の形式ではありません`];
  return releases.some((r) => r.version === tag) ? [] : [`タグ ${tag} に対応するリリースノートのエントリがありません`];
}

/** GitHub のリリース本文(Markdown)を作る。 */
export function formatRelease(release: Release): string {
  const labels: Record<string, string> = { feat: "機能", fix: "修正", docs: "文書", dev: "開発" };
  const lines = [`${release.title}`, ""];
  for (const item of release.items) {
    lines.push(`- ${labels[item.type] ?? item.type}: ${item.text}`);
  }
  return `${lines.join("\n")}\n`;
}
