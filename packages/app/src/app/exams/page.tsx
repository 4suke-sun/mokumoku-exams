import type { Metadata } from "next";
import Link from "next/link";
import { DomainMenu } from "@/components/domain-menu.tsx";
import { listExams } from "@/lib/exam-data.ts";
import { filterByVendor, groupByVendor, tileText } from "@/lib/exam-list.ts";
import type { Exam } from "@/lib/types.ts";

export const metadata: Metadata = { title: "資格を選ぶ" };

/** ベンダーごとの色(分野の色と同じ段階。globals.css の tone-domain-*)。Tailwind が見つけられるよう、省略せずに書く */
const VENDOR_TONES = [
  "tone-domain-1",
  "tone-domain-2",
  "tone-domain-3",
  "tone-domain-4",
  "tone-domain-5",
  "tone-domain-6",
];

/** ベンダーの色のタイル(略称)。文字は資格コードや名前でも読めるので、読み上げない。 */
function ExamTile({ exam, tone }: { exam: Exam; tone: string }) {
  return (
    <span
      aria-hidden="true"
      className={`tile h-12 w-14 flex-none text-sm font-bold ${tone}`}
      style={{ color: "color-mix(in srgb, var(--tone) 80%, var(--text))" }}
    >
      {tileText(exam)}
    </span>
  );
}

/** ベンダーの絞り込みの切り替え。選んだ項目は `aria-current` で示す(選択は URL の `?vendor=` だけに持ち、保存しない) */
function VendorFilter({ vendors, current }: { vendors: readonly string[]; current: string | null }) {
  const items = [{ label: "すべて", href: "/exams", selected: current === null }].concat(
    vendors.map((vendor) => ({
      label: vendor,
      href: `/exams?vendor=${encodeURIComponent(vendor)}`,
      selected: current === vendor,
    })),
  );
  return (
    <nav aria-label="ベンダーで絞り込む" className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={item.selected ? "page" : undefined}
          className={`chip ${item.selected ? "tone-primary font-bold" : "tone-muted"}`}
        >
          <span aria-hidden="true">{item.selected ? "✓ " : ""}</span>
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export default async function ExamsPage({ searchParams }: { searchParams: Promise<{ vendor?: string | string[] }> }) {
  const all = groupByVendor(listExams(), VENDOR_TONES.length);
  const { vendor } = await searchParams;
  const groups = filterByVendor(all, vendor);
  const current = groups.length === 1 && all.length > 1 ? (groups[0]?.vendor ?? null) : null;

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <h1 className="h1">資格を選ぶ</h1>
        <p className="text-muted">学習する資格を選んでください。ベンダーごとに、レベルの順に並べています。</p>
      </div>

      {all.length > 1 ? <VendorFilter vendors={all.map((g) => g.vendor)} current={current} /> : null}

      {groups.map((group) => {
        const tone = VENDOR_TONES[group.colorIndex] ?? "tone-domain-1";
        const headingId = `vendor-${group.colorIndex}`;
        return (
          <section key={group.vendor} aria-labelledby={headingId} className="space-y-3">
            <h2 id={headingId} className="h2">
              {group.vendor}
            </h2>
            <ul className="motion-stagger grid gap-3 lg:grid-cols-2">
              {group.exams.map((exam) =>
                exam.status === "published" ? (
                  <li key={exam.examCode} className="card space-y-3 p-4">
                    <div className="flex gap-3">
                      <ExamTile exam={exam} tone={tone} />
                      <div className="min-w-0 flex-1 space-y-1">
                        <Link href={`/exams/${exam.examCode}`} className="block hover:underline">
                          <span className="block text-lg font-bold">{exam.name}</span>
                          <span className="block text-sm text-muted">
                            {exam.examCode}({exam.edition})
                          </span>
                          <span className="mt-1 block text-sm text-muted">
                            {exam.officialQuestionCount} 問 / {exam.officialTimeMinutes} 分 / 合格 {exam.passingScore}{" "}
                            点 (満点 {exam.totalScore} 点)
                          </span>
                        </Link>
                        {exam.level ? <span className="chip tone-primary">{exam.level}</span> : null}
                      </div>
                    </div>
                    <Link
                      href={`/exams/${exam.examCode}/info`}
                      className="inline-block text-sm text-primary hover:underline"
                    >
                      {exam.shortName}の試験の情報
                    </Link>
                    <DomainMenu exam={exam} />
                  </li>
                ) : (
                  // 近日公開は、面を半透明にして区別する(文字は、そのままのコントラストで読める)
                  <li key={exam.examCode} className="rounded-lg border border-dashed border-line bg-surface/60 p-4">
                    <div className="flex gap-3">
                      <ExamTile exam={exam} tone={tone} />
                      <div className="min-w-0 flex-1 space-y-1">
                        <span className="block text-lg font-bold">{exam.name}</span>
                        <span className="block text-sm text-muted">{exam.examCode}</span>
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="chip tone-warn">近日公開</span>
                          {exam.level ? <span className="chip tone-muted">{exam.level}</span> : null}
                        </p>
                        <span className="block text-sm text-warn">{exam.note ?? "近日公開予定です。"}</span>
                      </div>
                    </div>
                  </li>
                ),
              )}
            </ul>
          </section>
        );
      })}
    </section>
  );
}
