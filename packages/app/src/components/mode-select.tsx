"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { Notice } from "@/components/notice.tsx";
import { domainColorClasses } from "@/lib/domain-color.ts";
import { fetchBookmarks, fetchReview } from "@/lib/history/client.ts";
import {
  domainCounts,
  isOfficialTarget,
  newOfficialSession,
  newSession,
  requestedDomains,
  sessionProgress,
  shuffle,
} from "@/lib/quiz.ts";
import {
  browserStore,
  clearSession,
  DEFAULT_SETTINGS,
  loadConditions,
  loadSession,
  loadSettings,
  type Reveal,
  type Session,
  saveConditions,
  saveSession,
  saveSettings,
} from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { fewerAnsweredWeight, weightedSample } from "@/lib/weighted.ts";
import { useAnswerCounts } from "./question-stats.tsx";

type PoolItem = {
  questionId: string;
  domain: string;
  questionType: Question["questionType"];
  difficulty?: Difficulty;
  choiceKeys: string[];
};

type Difficulty = NonNullable<Question["difficulty"]>;

const DIFFICULTIES: { id: Difficulty; name: string; tone: string }[] = [
  { id: "easy", name: "やさしい", tone: "tone-correct" },
  { id: "medium", name: "ふつう", tone: "tone-orange" },
  { id: "hard", name: "むずかしい", tone: "tone-incorrect" },
];

type Props = {
  exam: PublishedExam;
  pool: PoolItem[];
  /** カリキュラムがあり、学習モードを使えるか */
  studyAvailable?: boolean;
};

const COUNT_CHOICES = [5, 10, 20, 50];

/** 解答の表示のしかた(本番モードは、本番と同じく、まとめて最後に) */
const REVEALS: { id: Reveal; name: string; description: string }[] = [
  { id: "end", name: "まとめて最後に", description: "すべて解いてから採点し、結果の画面で正解と解説を見ます。" },
  {
    id: "each",
    name: "1 問ごと",
    description: "「回答する」を押すと、その問題の正誤と解説を出します。回答したあとは、選択を変えられません。",
  },
];

/** 出題の対象。復習プールとブックマークは、アカウントに保存したもの。 */
type Target = "all" | "review" | "bookmarks";

const TARGETS: { id: Target; name: string; description: string }[] = [
  { id: "all", name: "すべての問題", description: "資格のすべての問題から出題します。" },
  {
    id: "review",
    name: "復習プール",
    description: "間違えた問題から出題します。2 回続けて正解すると、プールから外れます。",
  },
  { id: "bookmarks", name: "ブックマーク", description: "ブックマークした問題から出題します。" },
];

type Mode = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  href?: string;
  /** 押すと、そのモードで出題を始める */
  onStart?: () => void;
};

function modesFor(exam: PublishedExam, studyAvailable: boolean, startOfficial: () => void): Mode[] {
  return [
    { id: "normal", name: "通常出題", description: "分野と問題数を選んで、1 問ずつ解きます。", enabled: true },
    {
      id: "official",
      name: "本番モード",
      description: `本番と同じ ${exam.officialQuestionCount} 問を、制限時間 ${exam.officialTimeMinutes} 分で解きます。選択式のすべての問題から出題し、時間切れで自動的に採点します。`,
      enabled: true,
      onStart: startOfficial,
    },
    {
      id: "sections",
      name: "セクションで解く",
      description: "全問を 5 問ずつに分けて、順に解きます。5 問中 4 問の正解で合格です。",
      enabled: true,
      href: `/exams/${exam.examCode}/sections`,
    },
    {
      id: "study",
      name: "学習モード",
      description: "単元ごとに読んでから解きます。",
      enabled: studyAvailable,
      href: `/exams/${exam.examCode}/study`,
    },
  ];
}

export function ModeSelect({ exam, pool, studyAvailable = false }: Props) {
  const router = useRouter();
  const countId = useId();
  const [domains, setDomains] = useState<string[]>([]);
  const [count, setCount] = useState<number>(Math.min(5, pool.length));
  const [error, setError] = useState<string | null>(null);
  const [shuffleChoices, setShuffleChoices] = useState(DEFAULT_SETTINGS.shuffleChoices);
  const [reveal, setReveal] = useState<Reveal>("end");
  const [resumable, setResumable] = useState<Session | null>(null);
  const [target, setTarget] = useState<Target>("all");
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [preferFewer, setPreferFewer] = useState(false);
  const answerCounts = useAnswerCounts(exam.examCode);
  // 取得できなかったときは null(その対象は選べない)
  const [lists, setLists] = useState<Record<Exclude<Target, "all">, string[] | null>>({
    review: null,
    bookmarks: null,
  });

  useEffect(() => {
    const store = browserStore();
    const settings = loadSettings(store);
    setShuffleChoices(settings.shuffleChoices);
    // 前回この資格で選んだ条件を、初期値にする(なければ、解答の表示だけ、全体の設定から)
    const conditions = loadConditions(store, exam.examCode);
    setReveal(conditions?.reveal ?? settings.reveal ?? "end");
    if (conditions) {
      setTarget(conditions.target);
      setDifficulties(conditions.difficulties);
      setCount(conditions.count);
      setPreferFewer(conditions.preferFewer);
    }
    // 学習の状況の「この分野を解く」から来たときは、その分野を選んでおく(`?domain=`)。ほかは前回の分野
    const codes = exam.domains.map((d) => d.code);
    const requested = requestedDomains(window.location.search, codes);
    setDomains(requested.length > 0 ? requested : (conditions?.domains ?? []).filter((d) => codes.includes(d)));
    const saved = loadSession(store, exam.examCode);
    // 出題中の問題が、いまのデータにすべてあるときだけ続きから解ける
    const ids = new Set(pool.map((p) => p.questionId));
    setResumable(saved?.questionIds.every((id) => ids.has(id)) ? saved : null);
  }, [exam.examCode, exam.domains, pool]);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchReview(exam.examCode), fetchBookmarks(exam.examCode)]).then(([review, bookmarks]) => {
      if (!active) return;
      setLists({ review, bookmarks });
      // 前回の条件の対象が、いまは読み込めないときは、全問に戻す
      const loaded = { review, bookmarks };
      setTarget((current) => (current !== "all" && loaded[current] === null ? "all" : current));
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
  // 対象で絞り、難易度で絞る(難易度を選んだときは、難易度のない問題を出さない)
  const targeted = inTarget(target).filter(
    (p) => difficulties.length === 0 || (p.difficulty !== undefined && difficulties.includes(p.difficulty)),
  );
  const perDomain = domainCounts(targeted);

  const available = domains.length === 0 ? targeted.length : targeted.filter((p) => domains.includes(p.domain)).length;
  const counts = [...COUNT_CHOICES.filter((n) => n < available), available];
  const effectiveCount = Math.min(count, available);

  function toggleDifficulty(id: Difficulty) {
    setDifficulties((current) => (current.includes(id) ? current.filter((d) => d !== id) : [...current, id]));
  }

  function toggleDomain(code: string) {
    setDomains((current) => (current.includes(code) ? current.filter((d) => d !== code) : [...current, code]));
  }

  function changeShuffle(next: boolean) {
    setShuffleChoices(next);
    saveSettings(browserStore(), { shuffleChoices: next, reveal });
  }

  function changeReveal(next: Reveal) {
    setReveal(next);
    saveSettings(browserStore(), { shuffleChoices, reveal: next });
  }

  function discard() {
    clearSession(browserStore(), exam.examCode);
    setResumable(null);
  }

  /** 出題の状態を保存して、出題の画面へ進む。保存できなければ、その旨を示してとどまる。 */
  function begin(session: Session) {
    if (!saveSession(browserStore(), session)) {
      setError("この端末では、出題の状態を保存できません。ブラウザの設定を確認してください。");
      return;
    }
    router.push(`/exams/${exam.examCode}/play`);
  }

  // 本番モードは、出題の対象と分野の選択によらず、資格の選択式のすべての問題から出題する(自由記述は含めない)
  function startOfficial() {
    if (!pool.some(isOfficialTarget)) {
      setError("出題できる問題がありません。");
      return;
    }
    begin(newOfficialSession(exam, pool, { shuffleChoices }, Math.random, new Date()));
  }

  function start() {
    const targets = domains.length === 0 ? targeted : targeted.filter((p) => domains.includes(p.domain));
    // 解答回数の少ない問題を優先するときは、重み 1/(1+回数)^2 で選ぶ(回数 0 の問題がいちばん出やすい)
    const picked = preferFewer
      ? weightedSample(
          targets,
          (p) => fewerAnsweredWeight(answerCounts.get(p.questionId) ?? 0),
          effectiveCount,
          Math.random,
        )
      : shuffle(targets, Math.random).slice(0, effectiveCount);
    if (picked.length === 0) {
      setError("出題できる問題がありません。出題の対象と分野の選択を見直してください。");
      return;
    }
    saveConditions(browserStore(), exam.examCode, {
      target,
      domains,
      difficulties,
      count: Math.max(1, effectiveCount),
      preferFewer,
      reveal,
    });
    const session = newSession(exam.examCode, picked, { shuffleChoices }, Math.random, new Date());
    begin(reveal === "each" ? { ...session, reveal } : session);
  }

  return (
    <section className="space-y-8">
      <div className="space-y-1">
        <Link href="/exams" className="text-sm text-primary hover:underline">
          資格の一覧へ戻る
        </Link>
        <h1 className="h1">{exam.name}</h1>
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
        <div className="card border-primary space-y-3 p-4">
          <h2 className="h2">前回の続きから</h2>
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
        <h2 className="h2">モード</h2>
        <ul className="space-y-2">
          {modesFor(exam, studyAvailable, startOfficial).map((mode) => (
            <li key={mode.id} className={`p-4 ${mode.enabled ? "card border-primary" : "card-dashed"}`}>
              {mode.enabled && mode.href ? (
                <Link href={mode.href} className="block font-bold text-primary hover:underline">
                  {mode.name}
                </Link>
              ) : mode.enabled && mode.onStart ? (
                <button
                  type="button"
                  onClick={mode.onStart}
                  className="block text-left font-bold text-primary hover:underline"
                >
                  {mode.name}を始める
                </button>
              ) : (
                <span className={`block font-bold ${mode.enabled ? "" : "text-muted"}`}>{mode.name}</span>
              )}
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
          // 復習の待ちがあるときは、色を付けて目立たせる
          const waiting = item.id === "review" && (lists.review?.length ?? 0) > 0;
          return (
            <label
              key={item.id}
              className={`flex items-start gap-3 rounded-md border p-3 ${
                waiting ? "border-warn bg-warn-bg" : "border-line bg-surface"
              } ${unavailable ? "opacity-50" : ""}`}
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
                {waiting ? <span className="ml-2 chip tone-warn">復習の待ちがあります</span> : null}
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
        {exam.domains.map((domain) => {
          const color = domainColorClasses(exam.domains, domain.code);
          return (
            <label
              key={domain.code}
              className={`flex items-center gap-3 rounded-md border border-l-4 border-line bg-surface p-3 ${color?.border ?? ""}`}
            >
              <input
                type="checkbox"
                className="size-5"
                checked={domains.includes(domain.code)}
                onChange={() => toggleDomain(domain.code)}
              />
              <span>
                <span className={`font-bold ${color?.text ?? ""}`}>{domain.name}</span>
                <span className="ml-2 text-sm text-muted">({perDomain[domain.code] ?? 0} 問)</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      <fieldset className="space-y-2">
        <legend className="text-lg font-bold">難易度</legend>
        <p className="text-sm text-muted">選ばないときは、すべての難易度から出題します。</p>
        <div className="flex flex-wrap gap-2">
          {DIFFICULTIES.map((item) => {
            const on = difficulties.includes(item.id);
            return (
              <button
                key={item.id}
                type="button"
                aria-pressed={on}
                onClick={() => toggleDifficulty(item.id)}
                className={`chip ${item.tone} border-2 px-3 py-1 text-sm ${on ? "border-current" : "border-transparent"}`}
              >
                <span aria-hidden="true">{on ? "✓ " : ""}</span>
                {item.name}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
        <input
          type="checkbox"
          className="size-5"
          checked={preferFewer}
          onChange={(event) => setPreferFewer(event.target.checked)}
        />
        <span>
          解答回数の少ない問題を優先する
          <span className="block text-sm text-muted">
            まだ解いていない問題や、解いた回数の少ない問題が出やすくなります。
          </span>
        </span>
      </label>

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

      <fieldset className="space-y-2">
        <legend className="text-lg font-bold">解答の表示</legend>
        {REVEALS.map((item) => (
          <label key={item.id} className="flex items-start gap-3 rounded-md border border-line bg-surface p-3">
            <input
              type="radio"
              name="reveal"
              className="mt-1 size-5"
              checked={reveal === item.id}
              onChange={() => changeReveal(item.id)}
            />
            <span>
              {item.name}
              <span className="block text-sm text-muted">{item.description}</span>
            </span>
          </label>
        ))}
        <p className="text-sm text-muted">本番モードは、本番と同じく、まとめて最後に採点します。</p>
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

      {available === 0 ? <p className="text-sm text-muted">選んだ条件に合う問題がありません。</p> : null}

      {error ? <Notice kind="error">{error}</Notice> : null}

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
