import type { NotebookEntry, NotebookFile, NotebookUnit } from "@mokumoku-exams/data-schema/notebook-data/schema";
import { findPublishedExam } from "./exam-data.ts";
import type { PublishedExam } from "./types.ts";

// リポジトリ直下の data/ の体系ノート(静的な JSON)を読む。形と参照は `npm run validate:data` が検査している。
// 型だけを参照し、検査の処理は読み込まない(データの契約は共有パッケージから読む。ADR 0011)。サーバー側(ビルド時を含む)だけで使う。

export type { NotebookEntry, NotebookUnit };

/** 体系ノートの全体。中分類は、資格マスタの分野の並び → 分野の中の並び順。見出しは、中分類の中の並び順 */
export type Notebook = { units: NotebookUnit[]; entries: NotebookEntry[] };

/** `type` のない図は、流れの図として扱う(データの検査と同じ決まり。中分類の図と見出しの図の両方) */
function withDiagramType<T extends { diagram?: NotebookUnit["diagram"] }>(item: T): T {
  return item.diagram && !("type" in item.diagram)
    ? { ...item, diagram: { type: "flow" as const, ...(item.diagram as object) } as T["diagram"] }
    : item;
}

/** 中分類を、資格マスタの分野の並び → 分野の中の並び順に並べ、見出しを中分類の中の並び順に並べる */
export function sortNotebook(domains: readonly { code: string }[], file: Pick<NotebookFile, "units" | "entries">) {
  const domainIndex = new Map(domains.map((d, i) => [d.code, i]));
  const rank = (code: string) => domainIndex.get(code) ?? domains.length;
  return {
    units: [...file.units].sort((a, b) => rank(a.domain) - rank(b.domain) || a.order - b.order),
    entries: [...file.entries].sort((a, b) => a.order - b.order),
  };
}

/**
 * 公開中の資格の体系ノートを読む。ファイル名は `notebook.<資格コードの英小文字>.json`。
 * 体系ノートは任意で、ファイルのない資格は null(入口を出さず、画面は 404)。
 */
export async function loadNotebook(exam: PublishedExam): Promise<Notebook | null> {
  try {
    const file = (await import(`../../../../data/notebook.${exam.examCode.toLowerCase()}.json`)) as {
      default: NotebookFile;
    };
    const sorted = sortNotebook(exam.domains, file.default);
    return { units: sorted.units.map(withDiagramType), entries: sorted.entries.map(withDiagramType) };
  } catch {
    return null;
  }
}

/**
 * 画面に出す見出し。利用者には検証済みだけを出し、未検証は管理者のプレビュー(`preview`)にだけ出す。
 * 利用者の画面は、この絞り込みのあとの見出しだけを使う(数・目次・関連のリンクも)。
 */
export function visibleEntries(entries: readonly NotebookEntry[], preview: boolean): NotebookEntry[] {
  return preview ? [...entries] : entries.filter((entry) => entry.status === "verified");
}

/**
 * 画面に出す中分類。利用者には、検証済みの中分類の導入・図・比較の表だけを出す。未検証の中分類は、題と並びだけを残し
 * (目次と見出しの置き場のため)、導入・図・表を外す。管理者のプレビュー(`preview`)は、すべてを出す。
 */
export function visibleUnits(units: readonly NotebookUnit[], preview: boolean): NotebookUnit[] {
  if (preview) return [...units];
  return units.map((unit) => {
    if (unit.status === "verified") return unit;
    const { intro: _intro, diagram: _diagram, comparison: _comparison, ...rest } = unit;
    return rest;
  });
}

/** 中分類の番号(`<分野の番号>-<分野の中の並び順>`)。分野の番号は、資格マスタの分野の並び(1 から) */
export function unitNumber(domains: readonly { code: string }[], unit: Pick<NotebookUnit, "domain" | "order">): string {
  const index = domains.findIndex((d) => d.code === unit.domain);
  return `${index < 0 ? "?" : index + 1}-${unit.order}`;
}

/** 目次の節(見出し)。並びは、画面に出す見出し(`visibleEntries`)の並び */
export type TocEntry = { id: string; term: string };
export type TocUnit = {
  id: string;
  number: string;
  title: string;
  /** 画面に出す見出しの数(`entries` の数) */
  count: number;
  /** 節。見出しのない中分類は空(目次で薄く出し、開けない) */
  entries: TocEntry[];
};
export type TocDomain = {
  code: string;
  /** 分野の番号(資格マスタの並び。1 から) */
  number: number;
  name: string;
  /** 配点(0〜1)。資格マスタにないときは undefined */
  weight?: number;
  units: TocUnit[];
  /** 分野の見出しの数 */
  count: number;
  /** 見出しのある中分類の数 */
  filled: number;
};

/** 目次: 分野 → 中分類 → 節(見出し)の 3 段。数と節は、渡した見出し(絞り込みのあと)で数える。中分類のない分野は出さない */
export function buildToc(
  domains: readonly { code: string; name: string; weight?: number }[],
  units: readonly NotebookUnit[],
  entries: readonly NotebookEntry[],
): TocDomain[] {
  const byUnit = new Map<string, TocEntry[]>();
  for (const entry of entries) {
    const list = byUnit.get(entry.unit) ?? [];
    list.push({ id: entry.id, term: entry.term });
    byUnit.set(entry.unit, list);
  }
  return domains.flatMap((domain, i) => {
    const own = units.filter((unit) => unit.domain === domain.code);
    if (own.length === 0) return [];
    const tocUnits = own.map((unit) => {
      const tocEntries = byUnit.get(unit.id) ?? [];
      return {
        id: unit.id,
        number: unitNumber(domains, unit),
        title: unit.title,
        count: tocEntries.length,
        entries: tocEntries,
      };
    });
    return [
      {
        code: domain.code,
        number: i + 1,
        name: domain.name,
        ...(domain.weight === undefined ? {} : { weight: domain.weight }),
        units: tocUnits,
        count: tocUnits.reduce((sum, unit) => sum + unit.count, 0),
        filled: tocUnits.filter((unit) => unit.count > 0).length,
      },
    ];
  });
}

/** 節の前後(同じ中分類の中。`entries` の並び)。端では null。前後の中分類へは、`neighborUnits` で移る */
export function neighborEntries(
  entries: readonly NotebookEntry[],
  unitId: string,
  entryId: string,
): { prev: NotebookEntry | null; next: NotebookEntry | null } {
  const own = entries.filter((entry) => entry.unit === unitId);
  const index = own.findIndex((entry) => entry.id === entryId);
  if (index < 0) return { prev: null, next: null };
  return { prev: own[index - 1] ?? null, next: own[index + 1] ?? null };
}

/** 前後の中分類(目次の並び)。端では null */
export function neighborUnits(
  units: readonly NotebookUnit[],
  id: string,
): { prev: NotebookUnit | null; next: NotebookUnit | null } {
  const index = units.findIndex((unit) => unit.id === id);
  if (index < 0) return { prev: null, next: null };
  return { prev: units[index - 1] ?? null, next: units[index + 1] ?? null };
}

/** 一言を、要点(マーカーを引く箇所)の前・要点・後に分ける。要点がない・見つからないときは、全体を前に置く */
export function splitKeyPhrase(oneLine: string, keyPhrase?: string): { before: string; key: string; after: string } {
  const at = keyPhrase ? oneLine.indexOf(keyPhrase) : -1;
  if (!keyPhrase || at < 0) return { before: oneLine, key: "", after: "" };
  return { before: oneLine.slice(0, at), key: keyPhrase, after: oneLine.slice(at + keyPhrase.length) };
}

/** 画面に必要なもの: 資格、中分類、画面に出す見出し(絞り込みのあと)、目次 */
export type NotebookPageData = {
  exam: PublishedExam;
  units: NotebookUnit[];
  entries: NotebookEntry[];
  toc: TocDomain[];
};

/**
 * 公開中の資格の体系ノートを、画面に出す形で読む。資格かノートがなければ null(画面は 404)。
 * `preview` は管理者のプレビュー(未検証の見出しも出す)。
 */
export async function loadNotebookPage(code: string, preview: boolean): Promise<NotebookPageData | null> {
  const exam = findPublishedExam(code);
  if (!exam) return null;
  const notebook = await loadNotebook(exam);
  if (!notebook) return null;
  const entries = visibleEntries(notebook.entries, preview);
  const units = visibleUnits(notebook.units, preview);
  return { exam, units, entries, toc: buildToc(exam.domains, units, entries) };
}
