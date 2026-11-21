/**
 * Issue の下書きの一覧(マニフェスト)からの、まとめての起票・編集(scripts/post-issues.ts)の判定。
 * 副作用のない関数にして単体テストする。報告は場所(行の番号、ファイル名)と種類だけ。
 *
 * 一覧は、行(エントリ)の配列。1 行が 1 件で、新規か編集か、下書きのファイル、編集なら Issue の番号、マイルストーン、ラベルを持つ。
 * 版の番号は、マイルストーン(`vX.Y.Z`)だけで持つ。版が未定の Issue は、マイルストーンを付けず、ラベル `later` を付ける。
 */

export interface ManifestEntry {
  action: "create" | "edit";
  /** 下書きのファイル(一覧のあるディレクトリからの相対) */
  file: string;
  /** 編集する Issue の番号(action が edit のとき) */
  number?: number;
  milestone?: string;
  labels?: string[];
  /** 承認の時点の封印(sha256。下書きのハッシュと、action・number・milestone・labels から作る。`--seal` で記録する) */
  sha256?: string;
  /** 投稿の結果(投稿のあとに書き戻す)。番号を読めなかったときは null */
  result?: { number: number | null; title: string; url: string };
}

export const LATER_LABEL = "later";
const TITLE = /^(?:feat|fix|docs|chore|test|ci|refactor|perf|style|build)(?:\([^)]+\))?!?: \S/;
const MILESTONE = /^v\d+\.\d+\.\d+$/;
// カンマ(gh が複数のラベルに分ける)と空を含まない
const LABEL = /^[^,\s][^,]*$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** 一覧の形式の検査。 */
export function validateManifest(data: unknown): string[] {
  if (!Array.isArray(data)) return ["一覧が配列でない"];
  const errors: string[] = [];
  const files = new Set<string>();
  const editNumbers = new Set<number>();
  data.forEach((entry, i) => {
    const at = `${i + 1} 行目`;
    if (!isRecord(entry)) {
      errors.push(`${at}: オブジェクトでない`);
      return;
    }
    if (entry.action !== "create" && entry.action !== "edit") errors.push(`${at}: action が create / edit でない`);
    if (
      typeof entry.file !== "string" ||
      entry.file === "" ||
      entry.file.includes("..") ||
      entry.file.startsWith("/")
    ) {
      errors.push(`${at}: file が相対のファイル名でない`);
    } else if (files.has(entry.file)) errors.push(`${at}: 同じ下書きが重なっている`);
    else files.add(entry.file);
    if (entry.action === "edit" && !(Number.isInteger(entry.number) && (entry.number as number) > 0)) {
      errors.push(`${at}: 編集には、Issue の番号(number)が要る`);
    }
    if (entry.action === "create" && entry.number !== undefined) errors.push(`${at}: 新規に number は付けない`);
    if (entry.action === "edit" && typeof entry.number === "number") {
      if (editNumbers.has(entry.number)) errors.push(`${at}: 同じ Issue を編集する行が重なっている`);
      editNumbers.add(entry.number);
    }
    if (entry.milestone !== undefined && !(typeof entry.milestone === "string" && MILESTONE.test(entry.milestone))) {
      errors.push(`${at}: milestone が vX.Y.Z の形でない`);
    }
    if (
      entry.labels !== undefined &&
      !(Array.isArray(entry.labels) && entry.labels.every((l) => typeof l === "string" && LABEL.test(l)))
    ) {
      errors.push(`${at}: labels が、カンマと空を含まない文字列の配列でない`);
    }
    // 版が未定の新規の Issue は、マイルストーンを付けず、later を付ける
    if (entry.action === "create" && entry.milestone === undefined) {
      const labels = Array.isArray(entry.labels) ? entry.labels : [];
      if (!labels.includes(LATER_LABEL))
        errors.push(`${at}: マイルストーンがない新規の Issue には、ラベル ${LATER_LABEL} が要る`);
    }
    if (entry.milestone !== undefined && Array.isArray(entry.labels) && entry.labels.includes(LATER_LABEL)) {
      errors.push(`${at}: マイルストーンがある Issue に、ラベル ${LATER_LABEL} は付けない`);
    }
    if (entry.result !== undefined) {
      const r = entry.result;
      const valid =
        isRecord(r) &&
        (r.number === null || Number.isInteger(r.number)) &&
        typeof r.title === "string" &&
        typeof r.url === "string";
      if (!valid) errors.push(`${at}: result の形が正しくない`);
    }
  });
  return errors;
}

export interface Draft {
  title: string;
  body: string;
}

/** 下書きの解釈。1 行目が `# タイトル`、2 行目が空行、3 行目以降が本文。2 行目が空行でなければ解釈しない。 */
export function parseDraft(text: string): Draft | null {
  const lines = text.split("\n");
  const first = lines[0] ?? "";
  if (!first.startsWith("# ") || first.length <= 2) return null;
  // 2 行目が空行でないと、ハッシュに入る文字が、投稿の本文から消える
  if ((lines[1] ?? "") !== "") return null;
  return { title: first.slice(2).trim(), body: lines.slice(2).join("\n") };
}

/** 下書きの内容の検査。題は Conventional Commits の形、本文に版の番号の行を書かない。 */
export function checkDraft(file: string, text: string): string[] {
  const draft = parseDraft(text);
  if (!draft) return [`${file}: 1 行目が「# タイトル」で、2 行目が空行の形でない`];
  const errors: string[] = [];
  if (!TITLE.test(draft.title)) errors.push(`${file}: タイトルが Conventional Commits の形でない`);
  // 箇条書き・番号付き・引用・見出し・表・太字で始まる行も対象にする
  if (/^[\s>*#|\d.-]*\**\s*(?:対象バージョン|対象の版|対象版|target version)\s*\**\s*[:\uFF1A]/im.test(draft.body)) {
    errors.push(`${file}: 本文に版の番号の行がある(版はマイルストーンだけで持つ)`);
  }
  return errors;
}

/** 封印の元になる文字列。下書きのハッシュと、投稿の内容を決める一覧の項目(action・number・milestone・labels)。 */
export function sealInput(entry: ManifestEntry, fileHash: string): string {
  return JSON.stringify({
    action: entry.action,
    number: entry.number ?? null,
    milestone: entry.milestone ?? null,
    labels: [...(entry.labels ?? [])].sort(),
    file: entry.file,
    draft: fileHash,
  });
}

/**
 * 一覧のファイル名の決まり。用途ごとの別名(`manifest-<用途>.json`。用途は英小文字・数字・ハイフン)にし、既定の名前(`manifest.json`)は使わない。
 * 並行するセッションが、同じ名前の一覧を書き換え合わないため(手順: .claude/skills/dev-pr の Step 1)。
 */
export const MANIFEST_NAME = /^manifest-[a-z0-9][a-z0-9-]{0,39}\.json$/;

/** 一覧のファイル名(パスの最後の部分)が、決まりの形か。 */
export function isManifestName(name: string): boolean {
  return MANIFEST_NAME.test(name);
}

/**
 * 封印のある未投稿の行と、封印のない未投稿の行が混ざっているとき、封印のない行の file を返す(混ざっていなければ空)。
 * 承認のあとに足された項目を、`--seal` で、検査と承認なしに封印しないため。投稿済みの行(result を持つ行)は数えない。
 * 封印のない行だけの一覧(最初の封印)は、承認のあとの追加と見分けられないので、空を返す。
 */
export function unsealedAmongSealed(entries: ManifestEntry[]): string[] {
  const pending = entries.filter((e) => !e.result);
  if (!pending.some((e) => e.sha256 !== undefined)) return [];
  return pending.filter((e) => e.sha256 === undefined).map((e) => e.file);
}

/** 封印(承認の時点の値)と、現在の値の照合。`current` は、ファイルごとの現在の封印。投稿済みの行は照合しない。 */
export function verifySeals(entries: ManifestEntry[], current: Record<string, string>): string[] {
  const errors: string[] = [];
  for (const e of entries) {
    if (e.result) continue;
    if (!e.sha256) errors.push(`${e.file}: 承認の時点の封印がない(--seal で記録する)`);
    else if (current[e.file] !== e.sha256) {
      errors.push(`${e.file}: 下書きまたは一覧の項目が、承認の時点から変わっている(検査と承認をやり直す)`);
    }
  }
  return errors;
}

/** `gh` に渡す引数を組み立てる。本文は、下書きのファイルから 3 行目以降を書き出したファイルで渡す。 */
export function ghArgs(entry: ManifestEntry, title: string, bodyFile: string): string[] {
  const labels = entry.labels ?? [];
  if (entry.action === "create") {
    return [
      "issue",
      "create",
      "--title",
      title,
      "--body-file",
      bodyFile,
      ...(entry.milestone ? ["--milestone", entry.milestone] : []),
      ...labels.flatMap((l) => ["--label", l]),
    ];
  }
  return [
    "issue",
    "edit",
    String(entry.number),
    "--title",
    title,
    "--body-file",
    bodyFile,
    // マイルストーンを付けるときは、版が未定の印(later)を外す
    ...(entry.milestone ? ["--milestone", entry.milestone, "--remove-label", LATER_LABEL] : []),
    ...labels.flatMap((l) => ["--add-label", l]),
  ];
}

/** `gh issue create` / `edit` が出力する URL から、Issue の番号を取り出す。 */
export function issueNumberFromUrl(output: string): number | null {
  const m = output.match(/\/issues\/(\d+)\s*$/m);
  return m ? Number(m[1]) : null;
}

/** 結果の一覧(番号・題・URL)。 */
export function formatResults(entries: ManifestEntry[]): string {
  const rows = entries.map((e) =>
    e.result
      ? `| ${e.result.number === null ? "#?" : `#${e.result.number}`} | ${e.result.title} | ${e.result.url} |`
      : `| (未投稿) | ${e.file} | |`,
  );
  return ["| 番号 | タイトル | URL |", "| --- | --- | --- |", ...rows].join("\n");
}
