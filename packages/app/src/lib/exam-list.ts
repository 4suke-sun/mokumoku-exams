import { EXAM_LEVELS } from "@mokumoku-exams/data-schema/exam-data/schema";
import type { Exam } from "./types.ts";

// 資格の一覧の整理: ベンダーごとに分け、その中を公開中・近日公開の順に、それぞれをレベルの順に並べる。画面から切り離した純粋な関数にして、単体テストする。

export type ExamLevel = (typeof EXAM_LEVELS)[number];

export type VendorGroup = {
  vendor: string;
  /** ベンダーの色の番号(0 始まり。分野の色と同じ段階。ベンダーの現れた順) */
  colorIndex: number;
  exams: Exam[];
};

/** レベルの順位(小さいほど上)。レベルを持たない資格は、最後 */
export function levelRank(level: ExamLevel | undefined): number {
  const index = level === undefined ? -1 : EXAM_LEVELS.indexOf(level);
  return index < 0 ? EXAM_LEVELS.length : index;
}

/** 公開の状態の順位(小さいほど上)。公開中を先に、近日公開をあとに置く */
function statusRank(exam: Pick<Exam, "status">): number {
  return exam.status === "published" ? 0 : 1;
}

/**
 * 資格を、ベンダーごとに分ける。ベンダーは、資格マスタに現れた順。
 * ベンダーの中は、公開中を先に、近日公開をあとに置き、それぞれをレベルの順にする
 * (同じレベルや、レベルを持たない資格は、資格マスタの並びのまま)。
 */
export function groupByVendor(exams: readonly Exam[], colorCount = 6): VendorGroup[] {
  const groups: VendorGroup[] = [];
  for (const exam of exams) {
    let group = groups.find((g) => g.vendor === exam.vendor);
    if (!group) {
      group = { vendor: exam.vendor, colorIndex: groups.length % colorCount, exams: [] };
      groups.push(group);
    }
    group.exams.push(exam);
  }
  for (const group of groups) {
    // Array.prototype.sort は安定なので、同じ順位は元の並びを保つ
    group.exams = [...group.exams].sort(
      (a, b) => statusRank(a) - statusRank(b) || levelRank(a.level) - levelRank(b.level),
    );
  }
  return groups;
}

/**
 * 絞り込みのベンダー(`?vendor=`)で、表示するグループを選ぶ。一覧にあるベンダーと一致したときだけ、そのグループに絞り、
 * 指定がない・一覧にない・複数指定のときは、すべてを返す。色の番号は、絞り込む前のままにする(絞り込んでも色が変わらないように)。
 */
export function filterByVendor(groups: readonly VendorGroup[], vendor: string | string[] | undefined): VendorGroup[] {
  const picked = typeof vendor === "string" ? groups.find((g) => g.vendor === vendor) : undefined;
  return picked ? [picked] : [...groups];
}

/** タイルに出す短い表記。`abbr` がなければ、資格コード(`<ベンダー>-<試験>-<版>`)の試験略称の部分(4 文字まで) */
export function tileText(exam: Pick<Exam, "abbr" | "examCode">): string {
  return exam.abbr ?? (exam.examCode.split("-")[1] ?? exam.examCode).slice(0, 4);
}
