"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { fetchBookmarks, fetchReview } from "@/lib/history/client.ts";
import { domainCounts, sessionProgress, shuffle, shuffleChoiceOrder } from "@/lib/quiz.ts";
import {
  browserStore,
  clearSession,
  DEFAULT_SETTINGS,
  loadSession,
  loadSettings,
  type Session,
  saveSession,
  saveSettings,
} from "@/lib/storage.ts";
import type { PublishedExam } from "@/lib/types.ts";

type PoolItem = { questionId: string; domain: string; choiceKeys: string[] };

type Props = { exam: PublishedExam; pool: PoolItem[] };

const COUNT_CHOICES = [5, 10, 20, 50];

/** 出題の対象。復習プールとブックマークは、アカウントに保存したもの。 */
type Target = "all" | "review" | "bookmarks";

const TARGETS: { id: Target; name: string; description: string }[] = [
  { id: "all", name: "すべての問題", description: "資格のすべての問題から出題します。" },
  { id: "review", name: "復習プール", description: "間違えた問題から出題します。正解すると、プールから外れます。" },
  { id: "bookmarks", name: "ブックマーク", description: "ブックマークした問題から出題します。" },
];

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
  const [shuffleChoices, setShuffleChoices] = useState(DEFAULT_SETTINGS.shuffleChoices);
  const [resumable, setResumable] = useState<Session | null>(null);
  const [target, setTarget] = useState<Target>("all");
  // 取得できなかったときは null(その対象は選べない)
  const [lists, setLists] = useState<Record<Exclude<Target, "all">, string[] | null>>({
    review: null,
    bookmarks: null,
  });

  useEffect(() => {
    const store = browserStore();
    setShuffleChoices(loadSettings(store).shuffleChoices);
    const saved = loadSession(store, exam.examCode);
    // 出題中の問題が、いまのデータにすべてあるときだけ続きから解ける
    const ids = new Set(pool.map((p) => p.questionId));
    setResumable(saved?.questionIds.every((id) => ids.has(id)) ? saved : null);
  }, [exam.examCode, pool]);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchReview(exam.examCode), fetchBookmarks(exam.examCode)]).then(([review, bookmarks]) => {
      if (active) setLists({ review, bookmarks });
    });
    return () => {
      active = false;
    };
  }, [exam.examCode]);

  // 対象で絞ってから、分野で絞る(いまのデータにない問題 ID は、ここで落ちる)
  const inTarget = (id: Target) => {
    if (id === "all") return pool;
    const ids = new Set(lists[id] ?? []);
    return pool.filter((p) => ids.has(p.questionId));
  };
  const targeted = inTarget(target);
  const perDomain = domainCounts(targeted);

  const available = domains.length === 0 ? targeted.length : targeted.filter((p) => domains.includes(p.domain)).length;
  const counts = [...COUNT_CHOICES.filter((n) => n < available), available];
  const effectiveCount = Math.min(count, available);

  function toggleDomain(code: string) {
    setDomains((current) => (current.includes(code) ? current.filter((d) => d !== code) : [...current, code]));
  }

  function changeShuffle(next: boolean) {
    setShuffleChoices(next);
    saveSettings(browserStore(), { shuffleChoices: next });
  }

  function discard() {
    clearSession(browserStore(), exam.examCode);
    setResumable(null);
  }

  function start() {
    const targets = domains.length === 0 ? targeted : targeted.filter((p) => domains.includes(p.domain));
    const questionIds = shuffle(targets, Math.random)
      .slice(0, effectiveCount)
      .map((p) => p.questionId);
    if (questionIds.length === 0) {
      setError("出題できる問題がありません。出題の対象と分野の選択を見直してください。");
      return;
    }
    const saved = saveSession(browserStore(), {
      examCode: exam.examCode,
      questionIds,
      answers: {},
      index: 0,
      startedAt: new Date().toISOString(),
      choiceOrder: shuffleChoices
        ? shuffleChoiceOrder(
            targets.filter((p) => questionIds.includes(p.questionId)),
            Math.random,
          )
        : undefined,
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
        <div className="flex flex-wrap gap-4 pt-1 text-sm">
          <Link href={`/exams/${exam.examCode}/dashboard`} className="text-primary hover:underline">
            学習の状況を見る
          </Link>
          <Link href="/bookmarks" className="text-primary hover:underline">
            直前チェック(ブックマーク)
          </Link>
        </div>
      </div>

      {resumable ? (
        <div className="space-y-3 rounded-lg border border-primary bg-surface p-4">
          <h2 className="text-lg font-bold">前回の続きから</h2>
          <p className="text-sm text-muted">
            {sessionProgress(resumable).total} 問中 {sessionProgress(resumable).answered} 問に回答しています。
            新しく始めると、この続きは消えます。
          </p>
          <div className="flex gap-3">
            <Link
              href={`/exams/${exam.examCode}/play`}
              className="flex-1 rounded-md bg-primary px-5 py-3 text-center font-bold text-on-primary hover:opacity-90"
            >
              続きから解く
            </Link>
            <button type="button" onClick={discard} className="rounded-md border border-line px-5 py-3 font-bold">
              破棄する
            </button>
          </div>
        </div>
      ) : null}

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
        <legend className="text-lg font-bold">出題の対象</legend>
        {TARGETS.map((item) => {
          const unavailable = item.id !== "all" && lists[item.id] === null;
          return (
            <label
              key={item.id}
              className={`flex items-start gap-3 rounded-md border border-line bg-surface p-3 ${unavailable ? "opacity-50" : ""}`}
            >
              <input
                type="radio"
                name="target"
                className="mt-1 size-5"
                checked={target === item.id}
                disabled={unavailable}
                onChange={() => setTarget(item.id)}
              />
              <span>
                {item.name}
                <span className="ml-2 text-sm text-muted">({inTarget(item.id).length} 問)</span>
                <span className="block text-sm text-muted">
                  {unavailable ? "アカウントから読み込めないため、いまは選べません。" : item.description}
                </span>
              </span>
            </label>
          );
        })}
      </fieldset>

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
            <span>
              {domain.name}
              <span className="ml-2 text-sm text-muted">({perDomain[domain.code] ?? 0} 問)</span>
            </span>
          </label>
        ))}
      </fieldset>

      <label className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
        <input
          type="checkbox"
          className="size-5"
          checked={shuffleChoices}
          onChange={(event) => changeShuffle(event.target.checked)}
        />
        <span>
          選択肢の並びをシャッフルする
          <span className="block text-sm text-muted">位置で答えを覚えてしまうのを防ぎます。採点は変わりません。</span>
        </span>
      </label>

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

      {available === 0 ? <p className="text-sm text-muted">選んだ条件に合う問題がありません。</p> : null}

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
