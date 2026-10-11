import type { Metadata } from "next";
import Link from "next/link";
import { RichText } from "@/components/rich-text.tsx";
import { type HelpLink as HelpLinkData, helpUpdatedAt, listHelpSections } from "@/lib/help-data.ts";

export const metadata: Metadata = { title: "使い方" };

const TOC_ID = "toc";

function HelpLink({ label, href }: { label: string; href: string }) {
  const className = "font-bold text-primary underline";
  // https の外部リンクは、新しいタブで開き、参照元の情報を渡さない
  return href.startsWith("/") ? (
    <Link href={href} className={className}>
      {label}
    </Link>
  ) : (
    <a href={href} target="_blank" rel="noopener noreferrer" className={className}>
      {label}(外部サイト)
    </a>
  );
}

function HelpLinks({ links }: { links?: readonly HelpLinkData[] }) {
  if (!links || links.length === 0) return null;
  return (
    <ul className="space-y-1">
      {links.map((link) => (
        <li key={link.href}>
          <HelpLink label={link.label} href={link.href} />
        </li>
      ))}
    </ul>
  );
}

function formatDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${y} 年 ${m} 月 ${d} 日`;
}

export default function HelpPage() {
  const sections = listHelpSections();
  const updatedAt = helpUpdatedAt();

  return (
    <article className="space-y-8">
      <div className="space-y-1">
        <h1 className="h1">使い方</h1>
        {updatedAt ? (
          <p className="text-sm text-muted">
            最終更新日: <time dateTime={updatedAt}>{formatDate(updatedAt)}</time>
          </p>
        ) : null}
      </div>

      {/* 目次は 2 段(節と、節の中の項目)。「目次へ戻る」の移動先 */}
      <nav id={TOC_ID} aria-labelledby="toc-title" tabIndex={-1} className="card space-y-3 p-4">
        <h2 id="toc-title" className="h3">
          目次
        </h2>
        <ol className="list-decimal space-y-1 pl-6">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-primary underline">
                {section.title}
              </a>
              {section.items && section.items.length > 0 ? (
                <ul className="mt-1 list-disc space-y-1 pl-5 text-sm">
                  {section.items.map((item) => (
                    <li key={item.id}>
                      <a href={`#${item.id}`} className="text-primary underline">
                        {item.title}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          ))}
        </ol>
      </nav>

      {sections.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="space-y-3">
          <h2 id={`${section.id}-title`} className="text-xl font-bold">
            {section.title}
          </h2>
          <RichText text={section.body} boldListLabels />
          <HelpLinks links={section.links} />
          {section.items?.map((item) => (
            <section key={item.id} id={item.id} aria-labelledby={`${item.id}-title`} className="card space-y-2 p-4">
              <h3 id={`${item.id}-title`} className="h3">
                {item.title}
              </h3>
              <RichText text={item.body} boldListLabels />
              <HelpLinks links={item.links} />
            </section>
          ))}
          <p>
            <a href={`#${TOC_ID}`} className="text-sm text-primary underline">
              目次へ戻る
            </a>
          </p>
        </section>
      ))}
    </article>
  );
}
