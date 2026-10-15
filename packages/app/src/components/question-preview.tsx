"use client";

import Link from "next/link";
import { useId, useState } from "react";
import { ChoiceReview } from "@/components/choice-review.tsx";
import { ExplanationView } from "@/components/explanation-view.tsx";
import { QuestionChips } from "@/components/question-chips.tsx";
import { ReferenceList } from "@/components/reference-list.tsx";
import { RichText } from "@/components/rich-text.tsx";
import { RubricView } from "@/components/rubric-view.tsx";
import {
  clampPage,
  EMPTY_FILTER,
  filterQuestions,
  PREVIEW_PAGE_SIZE,
  type PreviewFilter,
  pageCount,
} from "@/lib/question-filter.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";

type Props = { exam: Pick<PublishedExam, "examCode" | "name" | "domains">; questions: Question[] };

const DIFFICULTY_OPTIONS = [
  { id: "easy", label: "やさしい" },
  { id: "medium", label: "ふつう" },
  { id: "hard", label: "むずかしい" },
  { id: "none", label: "難易度なし" },
] as const;

const TYPE_OPTIONS = [
  { id: "single", label: "単一選択" },
  { id: "multiple", label: "複数選択" },
  { id: "free-text", label: "記述" },
] as const;

/** 押した状態(`aria-pressed`)を持つ、絞り込みのチップ。選んだものには ✓ を添える */
function FilterChip({ label, on, onToggle }: { label: string; on: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onToggle}
      className={`rounded-full border px-3 py-1 text-sm ${on ? "border-primary bg-soft font-bold text-primary" : "border-line bg-surface"}`}
    >
      <span aria-hidden="true">{on ? "✓ " : ""}</span>
      {label}
    </button>
  );
}

const toggled = <T,>(list: readonly T[], value: T): T[] =>
  list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

/**
 * 管理者が、資格の全問の正解・解説・出典をまとめて読み、校正するためのプレビュー。分野・難易度・種類・語で絞り込める。
 * 利用者の回答の画面とは別で、正解を最初から出す。
 */
export function QuestionPreview({ exam, questions }: Props) {
  const [filter, setFilter] = useState<PreviewFilter>(EMPTY_FILTER);
  const [page, setPage] = useState(0);
  const keywordId = useId();

  const matched = filterQuestions(questions, filter);
  const pages = pageCount(matched.length);
  const current = clampPage(page, matched.length);
  const shown = matched.slice(current * PREVIEW_PAGE_SIZE, (current + 1) * PREVIEW_PAGE_SIZE);

  function change(next: PreviewFilter) {
    setFilter(next);
    setPage(0);
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <Link href="/admin" className="text-sm text-primary hover:underline">
          管理へ戻る
        </Link>
        <h1 className="h1">{exam.name}の全問プレビュー</h1>
        <p className="text-sm text-muted">正解、解説、出典を、問題ごとに並べます。校正に使います。</p>
      </div>

      <form aria-label="絞り込み" className="card space-y-3 p-4" onSubmit={(event) => event.preventDefault()}>
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">分野</legend>
          <div className="flex flex-wrap gap-2">
            {exam.domains.map((domain) => (
              <FilterChip
                key={domain.code}
                label={domain.name}
                on={filter.domains.includes(domain.code)}
                onToggle={() => change({ ...filter, domains: toggled(filter.domains, domain.code) })}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">難易度</legend>
          <div className="flex flex-wrap gap-2">
            {DIFFICULTY_OPTIONS.map((option) => (
              <FilterChip
                key={option.id}
                label={option.label}
                on={filter.difficulties.includes(option.id)}
                onToggle={() => change({ ...filter, difficulties: toggled(filter.difficulties, option.id) })}
              />
            ))}
          </div>
        </fieldset>
        <fieldset className="space-y-2">
          <legend className="text-sm font-bold">問題の種類</legend>
          <div className="flex flex-wrap gap-2">
            {TYPE_OPTIONS.map((option) => (
              <FilterChip
                key={option.id}
                label={option.label}
                on={filter.types.includes(option.id)}
                onToggle={() => change({ ...filter, types: toggled(filter.types, option.id) })}
              />
            ))}
          </div>
        </fieldset>
        <div className="space-y-1">
          <label htmlFor={keywordId} className="block text-sm font-bold">
            語(問題 ID・問題文・解説)
          </label>
          <input
            id={keywordId}
            type="search"
            value={filter.keyword}
            onChange={(event) => change({ ...filter, keyword: event.target.value })}
            className="w-full rounded-md border border-line bg-bg px-3 py-2"
          />
        </div>
        <button
          type="button"
          onClick={() => change(EMPTY_FILTER)}
          className="rounded-md border border-line px-3 py-1 text-sm"
        >
          絞り込みを解除する
        </button>
      </form>

      <p role="status" className="text-sm text-muted">
        {matched.length} 問(全 {questions.length} 問)
        {matched.length > 0 ? `。${current + 1} / ${pages} ページ` : ""}
      </p>

      {matched.length === 0 ? <p className="card-dashed p-4 text-muted">条件に合う問題がありません。</p> : null}

      <ol className="space-y-4">
        {shown.map((question) => (
          <li key={question.questionId} className="card space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold">{question.questionId}</span>
              <QuestionChips domains={exam.domains} question={question} />
            </div>
            <RichText text={question.questionText} className="font-bold" />
            {question.questionType === "free-text" ? (
              <RubricView mode="keywords" rubric={question.rubric} />
            ) : (
              <>
                <ChoiceReview question={question} />
                <p className="text-sm font-bold text-correct">正解: {question.correctAnswers.join("、")}</p>
              </>
            )}
            <div className="space-y-2 border-t border-line pt-3">
              <h3 className="font-bold">解説</h3>
              <ExplanationView question={question} headingLevel={4} />
            </div>
            <ReferenceList references={question.references} />
          </li>
        ))}
      </ol>

      {matched.length > PREVIEW_PAGE_SIZE ? (
        <nav aria-label="ページ" className="flex items-center justify-between gap-3">
          <button
            type="button"
            disabled={current === 0}
            onClick={() => setPage(current - 1)}
            className="rounded-md border border-line bg-surface px-4 py-2 font-bold disabled:opacity-50"
          >
            前のページ
          </button>
          <span className="text-sm text-muted">
            {current + 1} / {pages}
          </span>
          <button
            type="button"
            disabled={current >= pages - 1}
            onClick={() => setPage(current + 1)}
            className="rounded-md border border-line bg-surface px-4 py-2 font-bold disabled:opacity-50"
          >
            次のページ
          </button>
        </nav>
      ) : null}
    </section>
  );
}
