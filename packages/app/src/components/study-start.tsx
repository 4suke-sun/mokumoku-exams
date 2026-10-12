"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Notice } from "@/components/notice.tsx";
import { UnitPractice } from "@/components/unit-practice.tsx";
import { newSession } from "@/lib/quiz.ts";
import {
  browserStore,
  loadSession,
  loadSettings,
  loadStageProgress,
  passedStages,
  type Session,
  saveSession,
} from "@/lib/storage.ts";
import type { NextStep } from "@/lib/study-nav.ts";
import { STAGE_PASS_PERCENT, type StageStatus, stageStatuses } from "@/lib/study-stages.ts";
import type { ChoiceQuestion, PublishedExam } from "@/lib/types.ts";

type Item = { questionId: string; choiceKeys: string[] };

type Props = {
  exam: Pick<PublishedExam, "examCode" | "domains">;
  /** 単元の問題(択一・複数選択)。その場で 1 問ずつ解く */
  questions: ChoiceQuestion[];
  /** 単元を終えたあとに進む先 */
  next: NextStep;
  /** 段階学習: 単元の ID と、順番の小さい順に並べた段階(段階のない単元では省く) */
  stages?: { unitId: string; list: { order: number; items: Item[] }[] };
};

const STATUS_LABEL: Record<StageStatus, string> = {
  passed: "合格済み",
  open: "挑戦できます",
  locked: "前の段階に合格すると挑戦できます",
};

const STATUS_CLASS: Record<StageStatus, string> = {
  passed: "text-correct",
  open: "text-primary",
  locked: "text-muted",
};

/**
 * 学習モードの出題。「この単元の問題を解く」で、単元の問題をその場で 1 問ずつ解く(UnitPractice)。
 * 段階のある単元では、段階ごとの確認問題も始められる(前の段階に合格した段階だけ。出題の画面で解き、結果で段階の合否を決める)。
 */
export function StudyStart({ exam, questions, next, stages }: Props) {
  const examCode = exam.examCode;
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(false);
  const [passed, setPassed] = useState<number[]>([]);
  const unitId = stages?.unitId;

  useEffect(() => {
    const store = browserStore();
    setHasSession(loadSession(store, examCode) !== null);
    if (unitId) setPassed(passedStages(loadStageProgress(store, examCode), unitId));
  }, [examCode, unitId]);

  function start(list: readonly Item[], stage?: Session["stage"]) {
    if (list.length === 0) {
      setError("出題できる問題がありません。");
      return;
    }
    const store = browserStore();
    // 解答の表示のしかたは、モード選択で最後に選んだもの(学習モードでも、1 問ごとに確かめられる)
    const { shuffleChoices, reveal } = loadSettings(store);
    const session = newSession(examCode, list, { shuffleChoices }, Math.random, new Date());
    const withReveal = reveal === "each" ? { ...session, reveal } : session;
    if (!saveSession(store, stage ? { ...withReveal, stage } : withReveal)) {
      setError("この端末では、出題の状態を保存できません。ブラウザの設定を確認してください。");
      return;
    }
    router.push(`/exams/${examCode}/play`);
  }

  const statuses = stages ? stageStatuses(stages.list, passed) : [];

  return (
    <div className="space-y-4">
      {hasSession ? (
        <p className="text-sm text-muted">出題の途中の状態があります。新しく始めると、その続きは消えます。</p>
      ) : null}
      {error ? <Notice kind="error">{error}</Notice> : null}
      {stages && stages.list.length > 0 ? (
        <section aria-labelledby="study_stages-title" className="card space-y-3 p-4">
          {/* 節の ID(英小文字・数字・ハイフン)と重ならないよう、下線を含む ID にする */}
          <h2 id="study_stages-title" className="text-xl font-bold">
            段階ごとに確かめる
          </h2>
          <p className="text-sm text-muted">
            段階の確認問題を解き、正答率が {STAGE_PASS_PERCENT}% 以上なら、次の段階へ進めます。
          </p>
          <ol className="space-y-3">
            {stages.list.map((stage, i) => {
              const status = statuses[i] ?? "locked";
              return (
                <li key={stage.order} className="space-y-2 border-t border-line pt-3 first:border-t-0 first:pt-0">
                  <p>
                    <span className="font-bold">段階 {i + 1}</span>
                    <span className={`ml-2 text-sm font-bold ${STATUS_CLASS[status]}`}>{STATUS_LABEL[status]}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => start(stage.items, { unitId: stages.unitId, order: stage.order })}
                    disabled={status === "locked" || stage.items.length === 0}
                    className="rounded-md border border-line bg-surface px-4 py-2 text-sm font-bold hover:border-primary disabled:opacity-50"
                  >
                    段階 {i + 1} の確認問題を解く({stage.items.length} 問)
                  </button>
                </li>
              );
            })}
          </ol>
        </section>
      ) : null}
      <UnitPractice exam={exam} questions={questions} next={next} />
    </div>
  );
}
