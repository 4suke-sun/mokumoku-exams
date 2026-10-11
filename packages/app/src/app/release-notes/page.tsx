import type { Metadata } from "next";
import { listReleases, RELEASE_ITEM_LABELS } from "@/lib/release-notes.ts";

export const metadata: Metadata = { title: "リリースノート" };

export default function ReleaseNotesPage() {
  const releases = listReleases();

  return (
    <article className="space-y-8">
      <h1 className="text-2xl font-bold">リリースノート</h1>
      <p className="text-muted">版ごとの変更の内容です。新しい版から順に並んでいます。</p>

      {releases.map((release) => (
        <section key={release.version} aria-labelledby={`${release.version}-title`} className="space-y-3">
          <h2 id={`${release.version}-title`} className="text-xl font-bold">
            {release.version}
            <time dateTime={release.date} className="ml-3 text-sm font-normal text-muted">
              {release.date}
            </time>
          </h2>
          <p className="font-bold">{release.title}</p>
          <ul className="space-y-2">
            {release.items.map((item) => (
              <li key={item.text} className="flex gap-2">
                <span className="h-fit shrink-0 rounded border border-line px-1 text-xs">
                  {RELEASE_ITEM_LABELS[item.type] ?? item.type}
                </span>
                <span>{item.text}</span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </article>
  );
}
