import type { NotebookComparison } from "@mokumoku-exams/data-schema/notebook-data/schema";
import Link from "next/link";
import { DiagramView } from "@/components/diagram.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import {
  NotebookCoverProgress,
  NotebookDomainProgress,
  NotebookReview,
  NotebookSectionChecks,
  NotebookSectionPager,
  NotebookSectionScope,
  NotebookSectionStatus,
} from "@/components/notebook-check.tsx";
import { ReferenceList } from "@/components/reference-list.tsx";
import { InlineText, RichText } from "@/components/rich-text.tsx";
import { domainColorClasses } from "@/lib/domain-color.ts";
import {
  type NotebookEntry,
  type NotebookUnit,
  neighborEntries,
  neighborUnits,
  splitKeyPhrase,
  type TocDomain,
  unitNumber,
} from "@/lib/notebook-data.ts";
import { reviewItemsOf } from "@/lib/notebook-review.ts";
import type { PublishedExam } from "@/lib/types.ts";

type ExamInfo = Pick<PublishedExam, "examCode" | "name" | "domains">;

/** 管理者のプレビューであることの注記(未検証の見出しも出す) */
function PreviewNote() {
  return (
    <p className="rounded-md border border-warn bg-warn-bg px-3 py-2 text-sm">
      管理者のプレビューです。未検証の見出しも出します(利用者の画面には、検証済みの見出しだけを出します)。
    </p>
  );
}

/** 表紙: 分野のタイル(番号・名前・配点・見出しの数・記載のある中分類の割合) */
export function NotebookCover({
  exam,
  toc,
  basePath,
  preview,
}: {
  exam: ExamInfo;
  toc: TocDomain[];
  basePath: string;
  preview: boolean;
}) {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <Link
          href={preview ? "/admin/preview" : `/exams/${exam.examCode}`}
          className="text-sm text-primary hover:underline"
        >
          {preview ? "全問のプレビューへ戻る" : "モード選択へ戻る"}
        </Link>
        <h1 className="h1">体系ノート</h1>
        <p className="text-sm text-muted">
          {exam.name}。試験の分野 → 出題範囲の項目(中分類)→ 用語の順に、用語の解説を並べます。
        </p>
      </div>
      {preview ? <PreviewNote /> : <NotebookCoverProgress toc={toc} basePath={basePath} />}
      <ol className="motion-stagger grid gap-3 sm:grid-cols-2">
        {toc.map((domain) => {
          const color = domainColorClasses(exam.domains, domain.code);
          const first = domain.units[0];
          const ratio = domain.units.length === 0 ? 0 : domain.filled / domain.units.length;
          return (
            <li key={domain.code}>
              <Link
                href={first ? `${basePath}/${first.id}` : basePath}
                className={`card h-full space-y-2 border-l-4 p-4 ${color?.border ?? ""}`}
              >
                <span className={`block font-bold ${color?.text ?? "text-primary"}`}>
                  {domain.number}. {domain.name}
                </span>
                <span className="block text-sm text-muted">
                  {domain.weight === undefined ? null : `配点 ${Math.round(domain.weight * 100)}% / `}見出し{" "}
                  {domain.count} 件 / 中分類 {domain.filled} / {domain.units.length} に記載
                </span>
                {preview ? null : <NotebookDomainProgress domain={domain} />}
                <span aria-hidden="true" className="block h-1.5 overflow-hidden rounded-full bg-bg">
                  <span className={`block h-full ${color?.bar ?? "bg-primary"}`} style={{ width: `${ratio * 100}%` }} />
                </span>
              </Link>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** 一言。要点(keyPhrase)に、マーカーを引く */
function OneLine({ entry }: { entry: NotebookEntry }) {
  const { before, key, after } = splitKeyPhrase(entry.oneLine, entry.keyPhrase);
  return (
    <p className="rounded-md bg-soft px-3 py-2 font-bold">
      {before}
      {key ? <mark className="notebook-marker motion-marker">{key}</mark> : null}
      {after}
    </p>
  );
}

/** 検証の状態のラベル。色だけでなく、文字と記号で伝える */
function StatusChip({ status }: { status: NotebookEntry["status"] }) {
  return status === "verified" ? (
    <span className="chip tone-correct">✓ 検証済み</span>
  ) : (
    <span className="chip tone-warn">! 未検証</span>
  );
}

/**
 * 節(見出し 1 つ分)のブロック: 一言 → 図 → 解説 → ここを押さえる → 確認 → 検証の状態 → 関連。
 * 確認の問いと記録の状態は、節の確認の状態(`NotebookSectionScope`)の中に置く。
 */
export function NotebookEntryBlock({
  entry,
  related,
  basePath,
  separated,
}: {
  entry: NotebookEntry;
  /** 関連する見出し(画面に出すものだけ) */
  related: NotebookEntry[];
  basePath: string;
  /** 上に区切りの線を引く(中分類の最初の節の、導入と図の下) */
  separated: boolean;
}) {
  const headingId = `${entry.id}-term`;
  return (
    <section
      id={entry.id}
      aria-labelledby={headingId}
      className={`scroll-mt-24 space-y-4 ${separated ? "border-t border-line pt-6" : ""}`}
    >
      <h2 id={headingId} className="h2">
        {entry.term}
      </h2>
      <OneLine entry={entry} />
      {entry.diagram ? (
        <div className="card p-4">
          {/* 図の要素の ID は、見出しの ID から作る(ページの中で一意) */}
          <DiagramView diagram={entry.diagram} id={`${entry.id}-diagram`} stackOnNarrow />
        </div>
      ) : null}
      <div className="space-y-2">
        <h3 className="h3 text-muted">解説</h3>
        <RichText text={entry.body} className="notebook-prose" />
      </div>
      {entry.examAngle ? (
        <div className="space-y-1 rounded-r-md border-l-4 border-warn bg-warn-bg px-4 py-3">
          <p className="font-bold text-warn">ここを押さえる</p>
          <RichText text={entry.examAngle} className="notebook-prose" />
        </div>
      ) : null}
      <div className="space-y-2">
        <h3 className="h3 text-muted">確認</h3>
        <NotebookSectionChecks entryId={entry.id} checks={entry.checks} />
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <StatusChip status={entry.status} />
        {related.length > 0 ? (
          <span className="text-muted">
            関連:{" "}
            {related.map((other, i) => (
              <span key={other.id}>
                {i > 0 ? "、" : null}
                <Link href={`${basePath}/${other.unit}/${other.id}`} className="text-primary underline">
                  {other.term}
                </Link>
              </span>
            ))}
          </span>
        ) : null}
      </div>
      <ReferenceList references={entry.references} />
    </section>
  );
}

/** 比較の表。狭い画面では、列の幅を固定して、文字を折り返す(横にはみ出さない) */
function ComparisonTable({ comparison }: { comparison: NotebookComparison }) {
  return (
    <section aria-labelledby="notebook-compare" className="space-y-3 border-t border-line pt-6">
      <h2 id="notebook-compare" className="h2">
        比べる
      </h2>
      <table className="notebook-prose w-full table-fixed border-collapse text-sm">
        <thead>
          <tr>
            <th scope="col" className="border border-line bg-bg p-2 text-left">
              観点
            </th>
            {comparison.columns.map((column) => (
              <th key={column} scope="col" className="wrap-anywhere border border-line bg-bg p-2 text-left">
                <InlineText text={column} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {comparison.rows.map((row) => (
            <tr key={row.aspect} className={row.highlight ? "bg-warn-bg" : undefined}>
              <th scope="row" className="wrap-anywhere border border-line p-2 text-left align-top">
                <InlineText text={row.aspect} />
                {row.highlight ? <span className="chip tone-warn ml-1 align-middle">要注意</span> : null}
              </th>
              {row.cells.map((cell, i) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 列の並びは固定
                <td key={i} className="wrap-anywhere border border-line p-2 align-top">
                  <InlineText text={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

/**
 * 節のページ: パンくず → 完了の行 →(中分類の最初の節だけ)題・導入・図 → 見出しのブロック → 前後の節 →
 * (最後の節だけ)比較の表 → ここまでのおさらい → 前後の中分類。
 * 見出しのない中分類(`entry` が null)は「まだ見出しがありません」を出す。
 * `entries` は、画面に出す見出し(利用者は検証済みだけ。管理者のプレビューは未検証も)を、ファイルの全体から渡す。
 */
export function NotebookSectionView({
  exam,
  units,
  unit,
  entry,
  entries,
  basePath,
  preview,
}: {
  exam: ExamInfo;
  units: NotebookUnit[];
  unit: NotebookUnit;
  entry: NotebookEntry | null;
  entries: NotebookEntry[];
  basePath: string;
  preview: boolean;
}) {
  const domain = exam.domains.find((d) => d.code === unit.domain);
  const color = domainColorClasses(exam.domains, unit.domain);
  const domainNumber = exam.domains.findIndex((d) => d.code === unit.domain) + 1;
  const own = entries.filter((e) => e.unit === unit.id);
  const byId = new Map(entries.map((e) => [e.id, e]));
  const { prev: prevUnit, next: nextUnit } = neighborUnits(units, unit.id);
  const label = (u: NotebookUnit) => `${unitNumber(exam.domains, u)} ${u.title}`;
  const isFirst = !entry || own[0]?.id === entry.id;
  const isLast = !!entry && own.at(-1)?.id === entry.id;
  const { prev, next } = entry ? neighborEntries(entries, unit.id, entry.id) : { prev: null, next: null };

  return (
    // 節ごとに作り直して、ページの切り替えの動きを 1 回出す
    <article key={entry?.id ?? unit.id} className="motion-page space-y-6">
      <div className="space-y-2">
        <nav aria-label="パンくずリスト" className="text-sm text-muted">
          <ol className="flex flex-wrap gap-x-1">
            <li>
              <Link href={basePath} className="text-primary hover:underline">
                体系ノート
              </Link>
              <span aria-hidden="true"> › </span>
            </li>
            <li className={`font-bold ${color?.text ?? ""}`}>
              {domainNumber}. {domain?.name}
              <span aria-hidden="true" className="font-normal text-muted">
                {" "}
                ›{" "}
              </span>
            </li>
            <li aria-current={entry ? undefined : "page"}>
              {label(unit)}
              {entry ? (
                <span aria-hidden="true" className="text-muted">
                  {" "}
                  ›{" "}
                </span>
              ) : null}
            </li>
            {entry ? <li aria-current="page">{entry.term}</li> : null}
          </ol>
        </nav>
        {entry ? <NotebookSectionStatus unitId={unit.id} entryId={entry.id} entryIds={own.map((e) => e.id)} /> : null}
        {isFirst ? (
          <>
            <h1 className="h1">{label(unit)}</h1>
            {unit.intro ? <p className="text-muted">{unit.intro}</p> : null}
          </>
        ) : (
          <h1 className="sr-only">{label(unit)}</h1>
        )}
      </div>

      {preview ? <PreviewNote /> : null}
      {preview && isFirst ? (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
          中分類の導入・図・表: <StatusChip status={unit.status} />
        </p>
      ) : null}

      {isFirst && unit.diagram ? (
        <div className="card p-4">
          <DiagramView diagram={unit.diagram} id={`${unit.id}-diagram`} stackOnNarrow />
        </div>
      ) : null}

      {entry ? (
        <NotebookSectionScope key={entry.id} unitId={unit.id} entryId={entry.id} total={entry.checks.length}>
          <div className="space-y-6">
            <NotebookEntryBlock
              entry={entry}
              related={(entry.related ?? []).flatMap((id) => byId.get(id) ?? [])}
              basePath={basePath}
              separated={isFirst}
            />
            <NotebookSectionPager
              basePath={basePath}
              unitId={unit.id}
              prev={prev ? { id: prev.id, term: prev.term } : null}
              next={next ? { id: next.id, term: next.term } : null}
            />
          </div>
        </NotebookSectionScope>
      ) : (
        <EmptyState
          icon="📝"
          title="まだ見出しがありません"
          description="この中分類の見出しは、これから書き足します。"
        />
      )}

      {isLast && unit.comparison ? <ComparisonTable comparison={unit.comparison} /> : null}

      {isLast ? (
        <NotebookReview
          key={unit.id}
          unit={{ id: unit.id, entries: own.map((e) => ({ id: e.id })) }}
          items={reviewItemsOf(own, unit.id)}
        />
      ) : null}

      <nav aria-label="前後の中分類" className="grid gap-3 border-t border-line pt-6 sm:grid-cols-2">
        {prevUnit ? (
          <Link href={`${basePath}/${prevUnit.id}`} className="card p-3 text-sm">
            <span className="block text-muted">← 前の中分類</span>
            <span className="block font-bold text-primary">{label(prevUnit)}</span>
          </Link>
        ) : (
          <span />
        )}
        {nextUnit ? (
          <Link href={`${basePath}/${nextUnit.id}`} className="card p-3 text-right text-sm">
            <span className="block text-muted">次の中分類 →</span>
            <span className="block font-bold text-primary">{label(nextUnit)}</span>
          </Link>
        ) : null}
      </nav>
    </article>
  );
}
