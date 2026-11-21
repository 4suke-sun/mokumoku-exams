import type { Metadata } from "next";
import { MarkReleasesSeen } from "@/components/release-seen.tsx";
import { listReleases, RELEASE_ITEM_LABELS, RELEASE_ITEM_TONES, userItems } from "@/lib/release-notes.ts";
import { releaseUrl } from "@/lib/site.ts";

export const metadata: Metadata = { title: "リリースノート" };

export default function ReleaseNotesPage() {
  const releases = listReleases();

  return (
    <article className="space-y-8">
      <MarkReleasesSeen />
      <h1 className="h1">リリースノート</h1>
      <p className="text-muted">
        版ごとの変更の内容です。新しい版から順に並んでいます。開発の仕組みの変更は、ここには載せていません。
      </p>

      {releases.map((release) => {
        const items = userItems(release);
        return (
          <section key={release.version} aria-labelledby={`${release.version}-title`} className="card space-y-3 p-5">
            <h2 id={`${release.version}-title`} className="text-xl font-bold">
              {release.version}
              <time dateTime={release.date} className="ml-3 text-sm font-normal text-muted">
                {release.date}
              </time>
            </h2>
            <p className="font-bold">{release.title}</p>
            {items.length === 0 ? (
              <p className="text-sm text-muted">
                開発者向けのアップデートです。詳細は
                {/* 外部リンクは、新しいタブで開き、参照元の情報を渡さない(使い方の画面と同じ) */}
                <a
                  href={releaseUrl(release.version)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary underline"
                >
                  こちら(外部サイト)
                </a>
                をご確認ください。
              </p>
            ) : (
              <ul className="space-y-2">
                {items.map((item) => (
                  <li key={item.text} className="flex gap-2">
                    <span className={`chip h-fit shrink-0 ${RELEASE_ITEM_TONES[item.type] ?? "tone-muted"}`}>
                      {RELEASE_ITEM_LABELS[item.type] ?? item.type}
                    </span>
                    <span>{item.text}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </article>
  );
}
