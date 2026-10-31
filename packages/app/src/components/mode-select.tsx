"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useState } from "react";
import { formatCheckedDate } from "@/components/exam-info.tsx";
import { Notice } from "@/components/notice.tsx";
import { domainColorClasses } from "@/lib/domain-color.ts";
import { fetchBookmarks, fetchReview } from "@/lib/history/client.ts";
import { changePrefs } from "@/lib/prefs-client.ts";
import {
  activeTargetOf,
  inDomains,
  inTarget,
  pickQuestions,
  type SettingsMode,
  type Target,
  targetQuestions,
} from "@/lib/question-pick.ts";
import {
  domainCounts,
  isOfficialTarget,
  newOfficialSession,
  newSession,
  passLinePercent,
  requestedDomains,
  sessionProgress,
} from "@/lib/quiz.ts";
import { SESSION_SAVE_FAILED, saveAndLocate } from "@/lib/start-session.ts";
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
  saveSettings,
} from "@/lib/storage.ts";
import type { PublishedExam, Question } from "@/lib/types.ts";
import { useStorageOwner } from "@/lib/use-storage-owner.ts";
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
  /** カリキュラムの単元の数。カリキュラムがなく、学習モードを使えないときは null */
  studyUnits?: number | null;
  /** 要約カードの枚数。要約カードがない資格では null(入口を出さない) */
  summaryCount?: number | null;
  /** 体系ノートの見出しの数(検証済みだけ)。体系ノートがない資格では null(入口を出さない) */
  notebookCount?: number | null;
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

const TARGETS: { id: Target; name: string; description: string }[] = [
  { id: "all", name: "すべての問題", description: "資格のすべての問題から出題します。" },
  {
    id: "review",
    name: "復習プール",
    description: "間違えた問題から出題します。2 回続けて正解すると、プールから外れます。",
  },
  { id: "bookmarks", name: "ブックマーク", description: "ブックマークした問題から出題します。" },
];

/** カードの動き。select は設定を出す、link は別の画面へ、start はそのまま出題を始める */
type ModeCard = {
  id: string;
  name: string;
  emoji: string;
  tone: string;
  description: string;
  /** カードの下に添える、数などの文字 */
  meta?: string;
  /** 選べない理由(カードを薄くして、押せなくする) */
  unavailable?: string;
} & ({ kind: "select"; mode: SettingsMode } | { kind: "link"; href: string } | { kind: "start" });

const MODE_NAMES: Record<SettingsMode, string> = { normal: "通常出題", review: "復習", "free-text": "自由記述" };

export function ModeSelect({ exam, pool, studyUnits = null, summaryCount = null, notebookCount = null }: Props) {
  const router = useRouter();
  const countId = useId();
  const [domains, setDomains] = useState<string[]>([]);
  const [count, setCount] = useState<number>(Math.min(5, pool.length));
  const [error, setError] = useState<string | null>(null);
  const [shuffleChoices, setShuffleChoices] = useState(DEFAULT_SETTINGS.shuffleChoices);
  const [reveal, setReveal] = useState<Reveal>("end");
  const [resumable, setResumable] = useState<Session | null>(null);
  const [target, setTarget] = useState<Target>("all");
  const [mode, setMode] = useState<SettingsMode | null>(null);
  const [difficulties, setDifficulties] = useState<Difficulty[]>([]);
  const [preferFewer, setPreferFewer] = useState(false);
  const [includeFreeText, setIncludeFreeText] = useState(false);
  const answerCounts = useAnswerCounts(exam.examCode);
  const owner = useStorageOwner();
  // 取得できなかったときは null(その対象は選べない)
  const [lists, setLists] = useState<Record<Exclude<Target, "all">, string[] | null>>({
    review: null,
    bookmarks: null,
  });

  useEffect(() => {
    // 持ち主の印が取れるまでは、端末の記録を読まない(印が取れたら、読み直す)
    if (owner === undefined) return;
    const store = browserStore();
    const settings = loadSettings(store);
    setShuffleChoices(settings.shuffleChoices);
    // 前回この資格で選んだ条件を、初期値にする(なければ、解答の表示だけ、全体の設定から)
    const conditions = loadConditions(store, exam.examCode);
    setReveal(conditions?.reveal ?? settings.reveal ?? "end");
    if (conditions) {
      setTarget(conditions.target);
      // 前に条件を選んでいたときは、そのモードの設定を開いたままにする
      setMode(conditions.target === "review" ? "review" : "normal");
      setDifficulties(conditions.difficulties);
      setCount(conditions.count);
      setPreferFewer(conditions.preferFewer);
      setIncludeFreeText(conditions.includeFreeText);
    }
    // 学習の状況の「この分野を解く」から来たときは、その分野を選んでおく(`?domain=`)。ほかは前回の分野
    const codes = exam.domains.map((d) => d.code);
    const requested = requestedDomains(window.location.search, codes);
    setDomains(requested.length > 0 ? requested : (conditions?.domains ?? []).filter((d) => codes.includes(d)));
    const saved = loadSession(store, exam.examCode);
    // 出題中の問題が、いまのデータにすべてあるときだけ続きから解ける
    const ids = new Set(pool.map((p) => p.questionId));
    setResumable(saved?.questionIds.every((id) => ids.has(id)) ? saved : null);
  }, [exam.examCode, exam.domains, pool, owner]);

  useEffect(() => {
    let active = true;
    void Promise.all([fetchReview(exam.examCode), fetchBookmarks(exam.examCode)]).then(([review, bookmarks]) => {
      if (!active) return;
      setLists({ review, bookmarks });
      // 前回の条件の対象が、いまは読み込めないときは、全問に戻す
      const loaded = { review, bookmarks };
      setTarget((current) => (current !== "all" && loaded[current] === null ? "all" : current));
      setMode((current) => (current === "review" && review === null ? "normal" : current));
    });
    return () => {
      active = false;
    };
  }, [exam.examCode]);

  // 対象と難易度で絞ってから、分野で絞る
  const activeTarget = activeTargetOf(mode, target);
  const targeted = targetQuestions(pool, { mode, target, lists, difficulties, includeFreeText });
  const perDomain = domainCounts(targeted);

  const available = inDomains(targeted, domains).length;
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
    // シャッフルは、端末とアカウントに保存する(解答の表示のしかたは、端末だけ)
    void changePrefs({ shuffleChoices: next });
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
    const href = saveAndLocate(browserStore(), session);
    if (!href) {
      setError(SESSION_SAVE_FAILED);
      return;
    }
    router.push(href);
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
    const picked = pickQuestions(inDomains(targeted, domains), {
      count: effectiveCount,
      preferFewer,
      answerCounts,
      random: Math.random,
    });
    if (picked.length === 0) {
      setError("出題できる問題がありません。出題の対象と分野の選択を見直してください。");
      return;
    }
    saveConditions(browserStore(), exam.examCode, {
      target: activeTarget,
      domains,
      difficulties,
      count: Math.max(1, effectiveCount),
      preferFewer,
      reveal,
      includeFreeText,
    });
    const session = newSession(exam.examCode, picked, { shuffleChoices }, Math.random, new Date());
    begin(reveal === "each" ? { ...session, reveal } : session);
  }

  const reviewWaiting = lists.review?.length ?? 0;
  const freeTextCount = pool.filter((p) => p.questionType === "free-text").length;
  const cards: ModeCard[] = [
    {
      id: "normal",
      name: "通常出題",
      emoji: "📝",
      tone: "tone-primary",
      description: "分野と問題数を選んで、1 問ずつ解きます。",
      meta: `${inTarget(pool, "normal", "all", lists, includeFreeText).length} 問`,
      kind: "select",
      mode: "normal",
    },
    {
      id: "review",
      name: "復習",
      emoji: "🔁",
      tone: "tone-orange",
      description: "間違えた問題と、自信なしの印を付けた問題から出題します。2 回続けて正解すると、外れます。",
      meta: lists.review === null ? undefined : `待ち ${reviewWaiting} 問`,
      unavailable: lists.review === null ? "アカウントから読み込めないため、いまは選べません。" : undefined,
      kind: "select",
      mode: "review",
    },
    ...(summaryCount === null
      ? []
      : [
          {
            id: "summary",
            name: "直前チェック(要約カード)",
            emoji: "🗂️",
            tone: "tone-domain-2",
            description: "要約カードを 1 枚ずつ見て、答えと決め手を確かめます。試験の直前の見返しに向きます。",
            meta: `${summaryCount} 枚`,
            kind: "link" as const,
            href: `/exams/${exam.examCode}/cards`,
          },
        ]),
    {
      id: "bookmarks",
      name: "直前チェック(ブックマーク)",
      emoji: "⭐",
      tone: "tone-violet",
      description: "ブックマークした問題を、正解と解説つきで見直します。",
      // 直前チェックは、選んだモードによらず、自由記述を含むすべてのブックマークを見直すので、モードで絞らずに数える
      meta:
        lists.bookmarks === null
          ? undefined
          : `ブックマーク ${inTarget(pool, null, "bookmarks", lists, true).length} 問`,
      kind: "link",
      href: "/bookmarks",
    },
    {
      id: "study",
      name: "学習モード",
      emoji: "📚",
      tone: "tone-correct",
      description: "単元ごとに読んでから解きます。",
      meta: studyUnits === null ? undefined : `${exam.domains.length} 分野・${studyUnits} 単元`,
      unavailable: studyUnits === null ? "準備中です" : undefined,
      kind: "link",
      href: `/exams/${exam.examCode}/study`,
    },
    ...(notebookCount === null
      ? []
      : [
          {
            id: "notebook",
            name: "体系ノート",
            emoji: "📓",
            tone: "tone-domain-5",
            description: "試験の分野と出題範囲の項目ごとに、用語の解説を読みます。",
            meta: `見出し ${notebookCount} 件`,
            kind: "link" as const,
            href: `/exams/${exam.examCode}/notebook`,
          },
        ]),
    {
      id: "sections",
      name: "セクションで解く",
      emoji: "🧩",
      tone: "tone-domain-3",
      description: "選択式の問題を 5 問ずつに分けて、順に解きます。5 問中 4 問の正解で合格です。",
      kind: "link",
      href: `/exams/${exam.examCode}/sections`,
    },
    {
      id: "free-text",
      name: "自由記述",
      emoji: "✍️",
      tone: "tone-domain-4",
      description: "文章で答える問題だけを解きます。回答に含まれる言葉で、観点ごとに判定します。",
      meta: `${freeTextCount} 問`,
      unavailable: freeTextCount === 0 ? "自由記述の問題がありません" : undefined,
      kind: "select",
      mode: "free-text",
    },
    {
      id: "official",
      name: "本番モード",
      emoji: "⏱️",
      tone: "tone-incorrect",
      description: `本番と同じ ${exam.officialQuestionCount} 問を、制限時間 ${exam.officialTimeMinutes} 分で解きます。選択式のすべての問題から出題し、時間切れで自動的に採点します。`,
      kind: "start",
    },
  ];
  const shortOfOfficial = pool.length < exam.officialQuestionCount;

  return (
    <section className="space-y-8">
      <div className="space-y-2">
        <Link href="/exams" className="text-sm text-primary hover:underline">
          資格の一覧へ戻る
        </Link>
        <h1 className="h1">{exam.name}</h1>
        <ul aria-label="資格の情報" className="flex flex-wrap items-center gap-2">
          <li className="chip tone-primary">{exam.examCode}</li>
          <li className="chip tone-correct">合格ライン {passLinePercent(exam)}%</li>
          <li className="chip tone-muted">問題 {pool.length} 問</li>
        </ul>
        {shortOfOfficial ? (
          <p className="text-sm text-warn">
            この資格の問題は {pool.length} 問で、本番の {exam.officialQuestionCount} 問に届いていません。
            本番モードは、いまある問題から出題します。
          </p>
        ) : null}
        {exam.info?.lastExamDate ? (
          <Notice kind="info">
            この版({exam.edition ?? exam.examCode})の試験は、{formatCheckedDate(exam.info.lastExamDate)}
            まで受験できます。それ以降は新しい版に切り替わります。
          </Notice>
        ) : null}
        <div className="flex flex-wrap gap-4 pt-1 text-sm">
          <Link href={`/exams/${exam.examCode}/info`} className="text-primary hover:underline">
            試験の情報
          </Link>
          <Link href={`/exams/${exam.examCode}/dashboard`} className="text-primary hover:underline">
            学習の状況を見る
          </Link>
          <Link href="/help" className="text-primary hover:underline">
            使い方
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
        <ul className="motion-stagger grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cards.map((card) => {
            const selected = card.kind === "select" && mode === card.mode;
            const waiting = card.id === "review" && reviewWaiting > 0;
            const blocked = card.unavailable !== undefined;
            const surface = blocked
              ? "card-dashed"
              : `card ${selected ? "border-primary bg-soft" : waiting ? "border-warn bg-warn-bg" : ""}`;
            // カード全体を押せるように、名前のボタン・リンクを、カードいっぱいに広げる
            const stretch = "after:absolute after:inset-0 after:content-['']";
            const nameClass = `block text-left font-bold ${stretch}`;
            return (
              <li
                key={card.id}
                className={`relative flex gap-3 p-4 has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-primary ${surface}`}
              >
                <span aria-hidden="true" className={`tile ${card.tone}`}>
                  {card.emoji}
                </span>
                <div className="min-w-0 space-y-1">
                  {blocked ? (
                    <span className="block font-bold text-muted">{card.name}</span>
                  ) : card.kind === "link" ? (
                    <Link href={card.href} className={`${nameClass} text-primary`}>
                      {card.name}
                    </Link>
                  ) : card.kind === "start" ? (
                    <button type="button" onClick={startOfficial} className={`${nameClass} text-primary`}>
                      {card.name}を始める
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-pressed={selected}
                      onClick={() => setMode(card.mode)}
                      className={`${nameClass} ${selected ? "text-primary" : ""}`}
                    >
                      <span aria-hidden="true">{selected ? "✓ " : ""}</span>
                      {card.name}
                    </button>
                  )}
                  <span className="block text-sm text-muted">
                    {card.description}
                    {card.unavailable ? `(${card.unavailable.replace(/。$/, "")})` : ""}
                  </span>
                  {card.meta ? <span className="block text-sm font-bold">{card.meta}</span> : null}
                  {waiting ? <span className="chip tone-warn">復習の待ちがあります</span> : null}
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {mode === null ? (
        <>
          <p className="text-sm text-muted">「通常出題」「復習」「自由記述」を選ぶと、出題の設定が出ます。</p>
          {error ? <Notice kind="error">{error}</Notice> : null}
        </>
      ) : (
        <div className="space-y-8">
          <h2 className="h2">{MODE_NAMES[mode]}の設定</h2>
          {mode === "normal" ? (
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
                      <span className="ml-2 text-sm text-muted">
                        ({inTarget(pool, mode, item.id, lists, includeFreeText).length} 問)
                      </span>
                      {waiting ? <span className="ml-2 chip tone-warn">復習の待ちがあります</span> : null}
                      <span className="block text-sm text-muted">
                        {unavailable ? "アカウントから読み込めないため、いまは選べません。" : item.description}
                      </span>
                    </span>
                  </label>
                );
              })}
            </fieldset>
          ) : null}

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

          {mode === "normal" ? (
            <label className="flex items-center gap-3 rounded-md border border-line bg-surface p-3">
              <input
                type="checkbox"
                className="size-5"
                checked={includeFreeText}
                onChange={(event) => setIncludeFreeText(event.target.checked)}
              />
              <span>
                自由記述の問題を含める
                <span className="block text-sm text-muted">
                  本番の試験は選択式だけです。オンにすると、自由記述の問題も出題します。
                </span>
              </span>
            </label>
          ) : null}

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
              <span className="block text-sm text-muted">
                位置で答えを覚えてしまうのを防ぎます。採点は変わりません。
              </span>
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
                  {n === available ? `すべて(${n} 問)` : `${n} 問`}
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
        </div>
      )}
    </section>
  );
}
