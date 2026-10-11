import type { Reference } from "@/lib/types.ts";

/** URL として読めれば、その URL を返す。読めなければ null。 */
function parseUrl(value: string): URL | null {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

/** 題のない出典に出す名前(URL のホスト名)。URL の形でなければ、URL をそのまま出す。 */
export function referenceLabel(reference: Reference): string {
  if (reference.title) return reference.title;
  return parseUrl(reference.url)?.hostname || reference.url;
}

/**
 * リンクにしてよい出典か。データの検査(許すドメインの一覧)に加え、画面の側でも、
 * URL として読めて https のものだけをリンクにする(javascript: などを、リンクにしない)。
 */
export function isLinkableReference(reference: Reference): boolean {
  return parseUrl(reference.url)?.protocol === "https:";
}

type Props = { references?: readonly Reference[] | undefined };

/**
 * 出典(公式ドキュメント)の一覧。外部サイトは、新しいタブで開き、参照元の情報を渡さない。
 * リンクにできない出典は、文字だけで出す。出典がなければ、何も出さない。
 */
export function ReferenceList({ references }: Props) {
  if (!references || references.length === 0) return null;
  return (
    <div className="space-y-1 text-sm">
      <h3 className="font-bold">出典</h3>
      <ul className="list-disc space-y-1 pl-6">
        {references.map((reference) => (
          <li key={reference.url}>
            {isLinkableReference(reference) ? (
              <a
                href={reference.url}
                target="_blank"
                rel="noopener noreferrer"
                className="break-all text-primary underline"
              >
                {referenceLabel(reference)}(外部サイト)
              </a>
            ) : (
              <span className="break-all">{referenceLabel(reference)}</span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
