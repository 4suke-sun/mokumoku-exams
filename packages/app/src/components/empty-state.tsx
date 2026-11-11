import Link from "next/link";

type Props = {
  title: string;
  description: string;
  action?: { label: string; href: string };
  /** 題の見出しの段階。画面の全体が空状態のときは 1、ページの中の一部のときは 2 */
  headingLevel?: 1 | 2;
};

/** まだ何もないことと、次にすることを伝える。点線の枠に、題、説明、ボタンを並べる(飾りのアイコンは置かない)。 */
export function EmptyState({ title, description, action, headingLevel = 2 }: Props) {
  const Heading = headingLevel === 1 ? "h1" : "h2";
  return (
    <section className="card-dashed space-y-3 px-4 py-10 text-center">
      <Heading className={headingLevel === 1 ? "h1" : "h2"}>{title}</Heading>
      <p className="text-muted">{description}</p>
      {action ? (
        <Link
          href={action.href}
          className="inline-block rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
        >
          {action.label}
        </Link>
      ) : null}
    </section>
  );
}
