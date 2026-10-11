import type { Metadata } from "next";
import Link from "next/link";
import { RichText } from "@/components/rich-text.tsx";
import { listHelpSections } from "@/lib/help-data.ts";

export const metadata: Metadata = { title: "使い方" };

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

export default function HelpPage() {
  const sections = listHelpSections();

  return (
    <article className="space-y-8">
      <h1 className="h1">使い方</h1>

      <nav aria-label="使い方の目次">
        <ol className="list-decimal space-y-1 pl-6">
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`} className="text-primary underline">
                {section.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      {sections.map((section) => (
        <section key={section.id} id={section.id} aria-labelledby={`${section.id}-title`} className="space-y-3">
          <h2 id={`${section.id}-title`} className="text-xl font-bold">
            {section.title}
          </h2>
          <RichText text={section.body} />
          {section.links && section.links.length > 0 ? (
            <ul className="space-y-1">
              {section.links.map((link) => (
                <li key={link.href}>
                  <HelpLink label={link.label} href={link.href} />
                </li>
              ))}
            </ul>
          ) : null}
        </section>
      ))}
    </article>
  );
}
