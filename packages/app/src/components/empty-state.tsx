import Link from "next/link";

type Props = {
  title: string;
  description: string;
  action?: { label: string; href: string };
};

export function EmptyState({ title, description, action }: Props) {
  return (
    <section className="space-y-4">
      <h1 className="text-2xl font-bold">{title}</h1>
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
