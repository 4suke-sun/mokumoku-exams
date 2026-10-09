"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { shuffle } from "@/lib/quiz.ts";
import { saveSession } from "@/lib/storage.ts";
import type { PublishedExam } from "@/lib/types.ts";

type PoolItem = { questionId: string; domain: string };

type Props = { exam: PublishedExam; pool: PoolItem[] };

const COUNT_CHOICES = [5, 10, 20, 50];

const MODES = [
  { id: "normal", name: "通常出題", description: "分野と問題数を選んで、1 問ずつ解きます。", enabled: true },
  { id: "official", name: "本番モード", description: "本番と同じ問題数と制限時間で解きます。", enabled: false },
  { id: "study", name: "学習モード", description: "単元ごとに読んでから解きます。", enabled: false },
];

export function ModeSelect({ exam, pool }: Props) {
  const router = useRouter();
  const countId = useId();
  const [domains, setDomains] = useState<string[]>([]);
  const [count, setCount] = useState<number>(Math.min(5, pool.length));
  const [error, setError] = useState<string | null>(null);

  const available = domains.length === 0 ? pool.length : pool.filter((p) => domains.includes(p.domain)).length;
  const counts = [...COUNT_CHOICES.filter((n) => n < available), available];
  const effectiveCount = Math.min(count, available);

  function toggleDomain(code: string) {
    setDomains((current) => (current.includes(code) ? current.filter((d) => d !== code) : [...current, code]));
  }

  function start() {
    const targets = domains.length === 0 ? pool : pool.filter((p) => domains.includes(p.domain));
    const questionIds = shuffle(targets, Math.random)
      .slice(0, effectiveCount)
      .map((p) => p.questionId);
    if (questionIds.length === 0) {
      setError("出題できる問題がありません。分野の選択を見直してください。");
      return;
    }
    const saved = saveSession(window.localStorage, {
      examCode: exam.examCode,
      questionIds,
      answers: {},
      index: 0,
      startedAt: new Date().toISOString(),
    });
    if (!saved) {
      setError("この端末では、出題の状態を保存できません。ブラウザの設定を確認してください。");
      return;
    }
    router.push(`/exams/${exam.examCode}/play`);
  }

  return (
    <section className="space-y-8">
      <div className="space-y-1">
        <Link href="/exams" className="text-sm text-primary hover:underline">
          資格の一覧へ戻る
        </Link>
        <h1 className="text-2xl font-bold">{exam.name}</h1>
      </div>

      <div className="space-y-3">
        <h2 className="text-lg font-bold">モード</h2>
        <ul className="space-y-2">
          {MODES.map((mode) => (
            <li
              key={mode.id}
              className={`rounded-lg border p-4 ${mode.enabled ? "border-primary bg-surface" : "border-dashed border-line"}`}
            >
              <span className={`block font-bold ${mode.enabled ? "" : "text-muted"}`}>{mode.name}</span>
              <span className="block text-sm text-muted">
                {mode.description}
                {mode.enabled ? "" : "(準備中です)"}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-lg font-bold">分野</legend>
        <p className="text-sm text-muted">選ばないときは、すべての分野から出題します。</p>
        {exam.domains.map((domain) => (
          <label key={domain.code} className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
            <input
              type="checkbox"
              className="size-5"
              checked={domains.includes(domain.code)}
              onChange={() => toggleDomain(domain.code)}
            />
            <span>{domain.name}</span>
          </label>
        ))}
      </fieldset>

      <div className="space-y-2">
        <label htmlFor={countId} className="block text-lg font-bold">
          問題数
        </label>
        <select
          id={countId}
          className="w-full rounded-md border border-line bg-surface p-3"
          value={effectiveCount}
          onChange={(event) => setCount(Number(event.target.value))}
        >
          {counts.map((n) => (
            <option key={n} value={n}>
              {n === available ? `全問(${n} 問)` : `${n} 問`}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <p role="alert" className="text-incorrect">
          {error}
        </p>
      ) : null}

      <button
        type="button"
        onClick={start}
        disabled={available === 0}
        className="w-full rounded-md bg-primary px-5 py-3 font-bold text-on-primary hover:opacity-90 disabled:opacity-50"
      >
        出題を始める
      </button>
    </section>
  );
}
