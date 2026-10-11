// 段階学習: 単元の段階を順に進む。段階の確認問題で、正答率が合格の基準以上なら、次の段階へ進める。

/** 段階の確認問題の合格の基準(正答率 %、この値以上で合格) */
export const STAGE_PASS_PERCENT = 80;

/** 確認問題の正答率が、合格の基準に届いているか。 */
export function isStagePassed(percent: number): boolean {
  return percent >= STAGE_PASS_PERCENT;
}

/** passed: 合格済み / open: 挑戦できる / locked: 前の段階に合格すると挑戦できる */
export type StageStatus = "passed" | "open" | "locked";

/**
 * 段階ごとの状態を返す。`stages` は順番の小さい順に並べたもの。`passed` は合格した段階の順番。
 * 最初の段階と、合格した段階のすぐ次の段階は、挑戦できる。合格済みの段階は、もう一度挑戦できる。
 */
export function stageStatuses(stages: readonly { order: number }[], passed: readonly number[]): StageStatus[] {
  const done = new Set(passed);
  return stages.map((stage, i) => {
    if (done.has(stage.order)) return "passed";
    const previous = stages[i - 1];
    return previous === undefined || done.has(previous.order) ? "open" : "locked";
  });
}
