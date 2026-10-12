import Link from "next/link";
import { HomePredictions } from "@/components/home-predictions.tsx";
import { ResumeCards } from "@/components/resume-cards.tsx";
import { toScored } from "@/lib/dashboard.ts";
import { listPublishedExams, loadQuestions } from "@/lib/exam-data.ts";

export default async function HomePage() {
  // 続きから解けるかの判定に必要な情報だけを渡す(問題の本文や正解は、出題画面で読み込む)
  const exams = await Promise.all(
    listPublishedExams().map(async (exam) => ({
      examCode: exam.examCode,
      name: exam.name,
      questionIds: (await loadQuestions(exam)).map((q) => q.questionId),
    })),
  );

  // 合格予測の集計に要る情報(正解と分野)だけを渡す
  const entries = await Promise.all(
    listPublishedExams().map(async (exam) => ({ exam, questions: (await loadQuestions(exam)).map(toScored) })),
  );

  return (
    <section className="space-y-6">
      <h1>
        {/* ロゴの画像は、背景が透明で、文字が濃い色なので、テーマにかかわらず明るい面に載せる */}
        <span className="brand-plate">
          {/* biome-ignore lint/performance/noImgElement: 小さな固定の画像なので、最適化の経路を通さずに出す */}
          <img
            src="/brand/logo-full.png"
            alt="もくもく問題集"
            width={640}
            height={203}
            className="h-20 w-auto sm:h-24"
          />
        </span>
      </h1>
      <p className="leading-relaxed text-muted">
        クラウド資格の学習用に、問題を解き、間違いを見直せます。資格を選んで、はじめましょう。
      </p>
      <ResumeCards exams={exams} />
      <HomePredictions entries={entries} />
      <Link
        href="/exams"
        className="inline-block rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90"
      >
        資格を選ぶ
      </Link>
    </section>
  );
}
