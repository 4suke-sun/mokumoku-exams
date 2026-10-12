"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Notice } from "@/components/notice.tsx";
import { syncSectionProgress } from "@/lib/history/client.ts";
import { newSession } from "@/lib/quiz.ts";
import {
  passedSectionCount,
  SECTION_SIZE,
  type SectionStatus,
  sectionPassLine,
  sectionStatus,
  sectionsOf,
} from "@/lib/sections.ts";
import {
  browserStore,
  loadSectionProgress,
  loadSession,
  loadSettings,
  type SectionProgress,
  type Session,
  saveSession,
} from "@/lib/storage.ts";
import type { PublishedExam } from "@/lib/types.ts";

type Item = { questionId: string; choiceKeys: string[] };

type Props = {
  exam: PublishedExam;
  /** 資格のすべての問題(データの並び) */
  items: Item[];
};

const STATUS: Record<SectionStatus, { mark: string; label: string; className: string }> = {
  perfect: { mark: "★", label: "満点", className: "chip tone-correct section-perfect" },
  passed: { mark: "✓", label: "合格", className: "chip tone-correct" },
  failed: { mark: "✗", label: "未達", className: "chip tone-incorrect" },
  untried: { mark: "-", label: "未挑戦", className: "chip tone-muted" },
};

/**
 * 5 問ずつのセクションの一覧。セクションごとの状態(満点・合格・未達・未挑戦)と、合格したセクションの数を出し、
 * 好きなセクションから始められる。途中で閉じたセクションの出題は、続きから解ける。
 */
export function SectionPicker({ exam, items }: Props) {
  const router = useRouter();
  const [progress, setProgress] = useState<SectionProgress>({ examCode: exam.examCode, best: {} });
  const [resumable, setResumable] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const sections = sectionsOf(items);

  useEffect(() => {
    const store = browserStore();
    // まず端末の進捗を出し、サーバーの進捗と 1 つにできたら、差し替える
    setProgress(loadSectionProgress(store, exam.examCode));
    let active = true;
    void syncSectionProgress(store, exam.examCode).then((synced) => {
      if (active) setProgress(synced);
    });
    const saved = loadSession(store, exam.examCode);
    setResumable(saved?.section !== undefined ? saved : null);
    return () => {
      active = false;
    };
  }, [exam.examCode]);

  function start(index: number) {
    const store = browserStore();
    const { shuffleChoices, reveal } = loadSettings(store);
    const session = {
      ...newSession(exam.examCode, sections[index] ?? [], { shuffleChoices }, Math.random, new Date()),
      section: index,
    };
    if (!saveSession(store, reveal === "each" ? { ...session, reveal } : session)) {
      setError("この端末では、出題の状態を保存できません。ブラウザの設定を確認してください。");
      return;
    }
    router.push(`/exams/${exam.examCode}/play`);
  }

  const passed = passedSectionCount(progress.best, sections.length);

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <Link href={`/exams/${exam.examCode}`} className="text-sm text-primary hover:underline">
          モード選択へ戻る
        </Link>
        <h1 className="h1">セクションで解く</h1>
        <p className="text-sm text-muted">
          {exam.name}。全問を 5 問ずつに分けて、順に解きます。5 問中 4 問(8 割)の正解で合格です。
        </p>
      </div>

      <p className="text-lg font-bold" aria-live="polite">
        {passed} / {sections.length} セクション合格
      </p>

      {resumable ? (
        <div className="card border-primary space-y-2 p-4">
          <p>セクション {(resumable.section ?? 0) + 1} の途中の出題があります。</p>
          <Link
            href={`/exams/${exam.examCode}/play`}
            className="inline-block rounded-md bg-primary px-4 py-2 font-bold text-on-primary hover:opacity-90"
          >
            続きから解く
          </Link>
        </div>
      ) : null}

      {error ? <Notice kind="error">{error}</Notice> : null}

      <ol className="motion-stagger grid gap-3 sm:grid-cols-2">
        {sections.map((section, index) => {
          const key = String(index);
          const record = Object.hasOwn(progress.best, key) ? progress.best[key] : undefined;
          const status = STATUS[sectionStatus(record)];
          const from = index * SECTION_SIZE + 1;
          return (
            <li key={key} className="card space-y-2 p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 className="h3">セクション {index + 1}</h2>
                <span className={status.className}>
                  <span aria-hidden="true">{status.mark}</span>
                  {status.label}
                </span>
              </div>
              <p className="text-sm text-muted">
                問題 {from}〜{from + section.length - 1}({section.length} 問、{sectionPassLine(section.length)}{" "}
                問の正解で合格)
                {record ? ` / これまでの最高 ${record.correct} 問` : null}
              </p>
              <button
                type="button"
                onClick={() => start(index)}
                className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-bold hover:border-primary"
              >
                セクション {index + 1} を解く
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
