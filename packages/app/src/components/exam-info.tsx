import Link from "next/link";
import { DomainBars } from "@/components/domain-bars.tsx";
import { domainColorClasses } from "@/lib/domain-color.ts";
import { passLinePercent } from "@/lib/quiz.ts";
import type { PublishedExam } from "@/lib/types.ts";

type Props = {
  exam: PublishedExam;
  /** この資格の問題の数 */
  questionCount: number;
  /** 選択式(択一・複数選択)の問題の数 */
  choiceCount: number;
  /** カリキュラムの単元の数。カリキュラムがなければ null */
  unitCount: number | null;
};

/** `YYYY-MM-DD` を「2026 年 10 月 12 日」の形にする。読めない値は、そのまま返す */
export function formatCheckedDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return y && m && d ? `${y} 年 ${m} 月 ${d} 日` : date;
}

/** 受験料の表示。補足があれば添える */
export function formatFee(fee: { amount: number; currency: string; note?: string | undefined }): string {
  const amount = `${fee.amount.toLocaleString("ja-JP")} ${fee.currency}`;
  return fee.note ? `${amount}(${fee.note})` : amount;
}

type Row = { label: string; value: string };

/**
 * 資格の情報ページ。受ける前に、試験の概要を 1 画面で確かめられるようにする。
 * 持たない項目は出さない(空欄にしない)。公式の情報は、確認した日を添える。
 * 外部リンクは、新しいタブで開き、参照元の情報を渡さない。
 */
export function ExamInfo({ exam, questionCount, choiceCount, unitCount }: Props) {
  const info = exam.info;
  const passLine = passLinePercent(exam);
  const overview: Row[] = [
    { label: "合格点", value: `${exam.passingScore} / ${exam.totalScore}(${passLine}%)` },
    { label: "問題数", value: `${exam.officialQuestionCount} 問` },
    { label: "試験時間", value: `${exam.officialTimeMinutes} 分` },
    ...(info?.format ? [{ label: "出題形式", value: info.format }] : []),
    ...(info?.languages ? [{ label: "受験できる言語", value: info.languages.join("、") }] : []),
    ...(info?.fee ? [{ label: "受験料", value: formatFee(info.fee) }] : []),
    ...(info?.validityYears ? [{ label: "認定の有効期間", value: `${info.validityYears} 年` }] : []),
    ...(exam.level ? [{ label: "レベル", value: exam.level }] : []),
  ];
  const domainRows = exam.domains.map((domain) => {
    const color = domainColorClasses(exam.domains, domain.code);
    const percent = Math.round(domain.weight * 1000) / 10;
    return {
      key: domain.code,
      label: domain.name,
      percent,
      detail: `${percent}%`,
      textClass: color?.text,
      barClass: color?.bar ?? "bg-primary",
    };
  });

  return (
    <article className="space-y-8">
      <div className="space-y-1">
        <Link href={`/exams/${exam.examCode}`} className="text-sm text-primary hover:underline">
          モード選択へ戻る
        </Link>
        <h1 className="h1">{exam.shortName}の試験の情報</h1>
        <p className="text-sm text-muted">
          {exam.name} / {exam.vendor} / {exam.examCode}({exam.edition})
        </p>
      </div>

      <section aria-labelledby="info_overview-title" className="space-y-3">
        <h2 id="info_overview-title" className="h2">
          試験の概要
        </h2>
        <dl className="motion-stagger grid grid-cols-2 gap-3 sm:grid-cols-3">
          {overview.map((row) => (
            <div key={row.label} className="card p-3">
              <dt className="text-sm text-muted">{row.label}</dt>
              <dd className="font-bold">{row.value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section aria-labelledby="info_domains-title" className="card space-y-3 p-4">
        <h2 id="info_domains-title" className="h2">
          分野と配点
        </h2>
        <p className="text-sm text-muted">公式の配点の比です。バーの長さが、配点の大きさを表します。</p>
        <DomainBars caption="分野ごとの配点" rows={domainRows} tableInSimple valueLabel="配点" />
      </section>

      <section aria-labelledby="info_content-title" className="space-y-2">
        <h2 id="info_content-title" className="h2">
          この問題集の内容
        </h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>
            問題 {questionCount} 問(選択式 {choiceCount} 問)
          </li>
          <li>{unitCount === null ? "学習モードは、準備中です" : `学習モードの単元 ${unitCount} 件`}</li>
        </ul>
      </section>

      {info?.guideUrl ? (
        <section aria-labelledby="info_guide-title" className="space-y-2">
          <h2 id="info_guide-title" className="h2">
            公式の試験ガイド
          </h2>
          <a
            href={info.guideUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block break-all text-primary underline"
          >
            {exam.name}の試験ガイド(外部サイト)
          </a>
        </section>
      ) : null}

      <p className="text-sm text-muted">
        {info
          ? `公式の情報を確認した日: ${formatCheckedDate(info.checkedAt)}。受験料や試験時間などは、変わることがあります。申し込む前に、公式の情報を確かめてください。`
          : "この資格は、受験料などの公式の詳しい情報を、まだ載せていません。"}
      </p>
    </article>
  );
}
