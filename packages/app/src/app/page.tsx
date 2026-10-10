import Link from "next/link";

export default function HomePage() {
  return (
    <section className="space-y-6">
      <h1 className="text-2xl font-bold">もくもく問題集</h1>
      <p className="leading-relaxed text-muted">
        クラウド資格の学習用に、問題を解き、間違いを見直せます。資格を選んで、はじめましょう。
      </p>
      <Link
        href="/exams"
        className="inline-block rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
      >
        資格を選ぶ
      </Link>
    </section>
  );
}
