import { z } from "zod";
import { REASON } from "../collect/ledger.ts";
import { type Decision, type DecisionsFile, DRAFT_ID, draftDecision } from "../decisions/decisions.ts";
import type { FactsFile } from "../facts/schema.ts";
import type { SamplingPlan } from "../sampling/plan.ts";
import type { ProvenanceFile } from "./provenance.ts";
import { evidenceLocations } from "./revise.ts";
import type { DraftRecord, DraftsFile } from "./store.ts";

/**
 * 人が要判断の下書き(通過と保留の下書きと、人が却下した下書き。設定 review.autoApprove に挙げた試験では、
 * 基準を満たして承認を省ける下書き、書き出し済みの下書き、基準を満たすが来歴の検査で止まる下書きを除く)を確かめるための表と、判断を書き込むシート。
 * 表には、設問文・選択肢・正答・解説、根拠にした事実カードの主張(出典の言い換え)と節、検証役が読む根拠の節の場所(出典の URL・節の名前・見出し)、
 * 出典の URL、警告と保留の理由コード、直した下書きの直す前の下書きの ID を載せる。
 * 取得した本文の写しは載せない。表とシートは作業用の置き場に出し、コミットしない。
 */

/**
 * 人が判断しなくてよい下書き(設定 review.autoApprove に挙げた試験だけ。書き出しと同じ判定で選ぶ)。
 * byCriteria: 基準を満たして承認なしで書き出せる下書き(export/criteria.ts の criteriaAccepted)。
 * exported: 書き出し済みの下書き(来歴に問題 ID がある)。
 * blocked: 来歴がないか、来歴の検査に落ちた下書き(人が承認しても、書き出せるようにならない)。
 * これらは書き出しの判定の入力で、表の分類(基準を満たして承認を省ける下書き、書き出し済みの下書き、
 * 基準を満たすが来歴の検査で止まる下書き)は、classify が、これらと人の判断を組み合わせて決める。
 */
export interface ReviewSkip {
  byCriteria: ReadonlySet<string>;
  exported: ReadonlySet<string>;
  blocked: ReadonlySet<string>;
}

export const NO_SKIP: ReviewSkip = { byCriteria: new Set(), exported: new Set(), blocked: new Set() };

/**
 * 確認の済み・未済。total・approved・rejected・pending は、要判断の下書き(下の 3 種類のどれにも当たらないもの)だけを数える。
 * 承認か却下の判断があるものを、確認済みとする。基準を満たして承認を省ける下書き、書き出し済みの下書き、
 * 基準を満たすが来歴の検査で止まる下書きは、別の件数にする(ID は表の冒頭にだけ出す)。
 */
export interface ReviewCounts {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
  byCriteria: string[];
  exported: string[];
  blocked: string[];
}

/** 確認の候補: 不採用でない下書き(人が却下したものは、確認済みとして数える)。抜き取りで確認しないものは除く */
function candidates(drafts: DraftsFile, decisions: DecisionsFile, plan?: SamplingPlan): DraftRecord[] {
  // 抜き取りのとき、通過した下書きのうち確認しないものは、対象にしない(人がすでに判断したものは、確認済みとして残す)
  const skipped = plan?.mode === "sample" ? new Set(plan.draft.notReviewed) : new Set<string>();
  return drafts.drafts.filter(
    (d) =>
      (d.status !== "rejected" || draftDecision(decisions, d.id) === "reject") &&
      (!skipped.has(d.id) || draftDecision(decisions, d.id) !== undefined),
  );
}

/**
 * 候補を、要判断・書き出し済み・基準を満たして承認を省ける・基準を満たすが来歴の検査で止まる、に分ける。
 * 分け方は、書き出し(export/export.ts の selectExportable)の順に合わせる。非公開の問題の書き直しは、必ず要判断にする。
 */
function classify(
  drafts: DraftsFile,
  decisions: DecisionsFile,
  plan: SamplingPlan | undefined,
  skip: ReviewSkip,
): { needed: DraftRecord[]; byCriteria: string[]; exported: string[]; blocked: string[] } {
  const result = {
    needed: [] as DraftRecord[],
    byCriteria: [] as string[],
    exported: [] as string[],
    blocked: [] as string[],
  };
  for (const d of candidates(drafts, decisions, plan)) {
    const decision = draftDecision(decisions, d.id);
    if (d.rewriteOf !== undefined) result.needed.push(d);
    else if (skip.exported.has(d.id)) result.exported.push(d.id);
    else if (skip.byCriteria.has(d.id) && decision === undefined)
      (skip.blocked.has(d.id) ? result.blocked : result.byCriteria).push(d.id);
    else result.needed.push(d);
  }
  return result;
}

/** 確認の対象: 要判断の下書き。表の節と、判断のシートの行になる */
export function reviewTargets(
  drafts: DraftsFile,
  decisions: DecisionsFile,
  plan?: SamplingPlan,
  skip: ReviewSkip = NO_SKIP,
): DraftRecord[] {
  return classify(drafts, decisions, plan, skip).needed;
}

export function reviewCounts(
  drafts: DraftsFile,
  decisions: DecisionsFile,
  plan?: SamplingPlan,
  skip: ReviewSkip = NO_SKIP,
): ReviewCounts {
  const { needed, byCriteria, exported, blocked } = classify(drafts, decisions, plan, skip);
  const approved = needed.filter((d) => draftDecision(decisions, d.id) === "approve").length;
  const rejected = needed.filter((d) => draftDecision(decisions, d.id) === "reject").length;
  return {
    total: needed.length,
    approved,
    rejected,
    pending: needed.length - approved - rejected,
    byCriteria,
    exported,
    blocked,
  };
}

/** Markdown の表の 1 マスに入れる。縦棒と改行を、表を壊さない形にする */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/** 人が判断しなくてよい下書きの件数と ID。どれも 0 件なら、何も出さない */
function skippedLines(counts: ReviewCounts): string[] {
  const groups: [string, string[]][] = [
    ["基準を満たして承認を省ける(却下するときは、判断の記録を直す)", counts.byCriteria],
    ["書き出し済み", counts.exported],
    ["基準を満たすが来歴の検査で止まる(人の承認では書き出せない)", counts.blocked],
  ];
  const shown = groups.filter(([, ids]) => ids.length > 0);
  if (shown.length === 0) return [];
  return [
    "",
    "表に載せない下書き:",
    "",
    ...shown.map(([label, ids]) => `- ${label}: ${ids.length} 件(${ids.join(", ")})`),
    "",
  ];
}

/** 下書きの確認用の表(Markdown)。1 件を 1 つの節にし、項目を表で並べる */
export function renderDraftReview(
  examCode: string,
  drafts: DraftsFile,
  facts: FactsFile,
  provenance: ProvenanceFile,
  decisions: DecisionsFile,
  plan?: SamplingPlan,
  skip: ReviewSkip = NO_SKIP,
): string {
  const counts = reviewCounts(drafts, decisions, plan, skip);
  const lines = [
    `# 下書きの確認(${examCode})`,
    "",
    `要判断 ${counts.total} 件(承認 ${counts.approved} 件、却下 ${counts.rejected} 件、未済 ${counts.pending} 件)。`,
    ...skippedLines(counts),
    ...(plan?.mode === "sample"
      ? [
          `抜き取りで確認する(率 ${plan.rate}、種 ${plan.seed})。通過した下書き ${plan.draft.eligible} 件のうち、確認するもの ${plan.draft.reviewed.length} 件、確認しないもの ${plan.draft.notReviewed.length} 件。保留は全件を確認する。`,
        ]
      : []),
    "判断は、同じ置き場の review-sheet.json に書き、`draft <試験コード> --decide` で取り込む。",
    "",
  ];
  for (const record of reviewTargets(drafts, decisions, plan, skip)) {
    const d = record.draft;
    const decision = draftDecision(decisions, record.id) ?? "未済";
    lines.push(`## ${record.id}`, "", "| 項目 | 内容 |", "| --- | --- |");
    lines.push(`| 状態 | ${record.status}(人の判断: ${decision}) |`);
    lines.push(`| 分野・難易度・種別 | ${record.domain} / ${record.difficulty} / ${d?.questionType ?? "-"} |`);
    if (record.revisionOf !== undefined) lines.push(`| 直す前の下書き | ${record.revisionOf} |`);
    if (record.rewriteOf !== undefined)
      lines.push(
        `| 書き直す非公開の問題(承認すると、判定が公開なら、この ID のまま公開へ戻る) | ${record.rewriteOf} |`,
      );
    if (d !== null) {
      lines.push(`| 設問文 | ${cell(d.questionText)} |`);
      if ("choices" in d) {
        for (const c of d.choices) {
          const mark = d.correctAnswers.includes(c.key) ? "(正答)" : "";
          lines.push(`| 選択肢 ${c.key}${mark} | ${cell(c.text)} |`);
        }
      } else {
        for (const c of d.rubric.criteria) {
          lines.push(`| 観点(${c.points} 点) | ${cell(c.name)}: ${cell(c.keywords.join("、"))} |`);
        }
        lines.push(`| 合格点 | ${d.rubric.passingPoints} |`);
      }
      lines.push(`| 解説 | ${cell(d.explanation)} |`);
      for (const id of d.factIds) {
        const card = facts.cards.find((c) => c.id === id);
        lines.push(
          card
            ? `| 根拠 ${id} | ${cell(card.claim)}(節: ${cell(card.sources[0]?.section ?? "-")}) |`
            : `| 根拠 ${id} | (事実カードがない) |`,
        );
      }
    }
    // 検証役が読む根拠の節の場所(出典の URL と見出し)。確認のときに、同じ節を読み直せるようにする。本文は載せない
    for (const loc of d !== null ? evidenceLocations(d.factIds, facts) : []) {
      lines.push(`| 検証の節 | ${cell(loc.url)}(節: ${cell(loc.section)}、見出し: ${cell(loc.heading)}) |`);
    }
    const entry = provenance.entries.find((e) => e.draftId === record.id);
    for (const s of entry?.sources ?? []) lines.push(`| 出典 | ${cell(s.url)} |`);
    if (record.reasons.length > 0) lines.push(`| 保留・不採用の理由 | ${cell(record.reasons.join(", "))} |`);
    const v = record.verification;
    lines.push(`| 検証 | ${v === undefined ? "未" : (v.verdict ?? "解説の確認待ち")} |`);
    if (v !== undefined && v.findings.length > 0) {
      lines.push(`| 検証の指摘 | ${cell(v.findings.map((f) => `${f.code} ${f.where}`).join(", "))} |`);
    }
    if (v?.checks.rederive !== undefined) {
      lines.push(
        `| 再導出の判定 | ${cell(v.checks.rederive.choices.map((c) => `${c.key}:${c.judgement}`).join(" "))} |`,
      );
    }
    if (record.warnings.length > 0) {
      lines.push(`| 警告 | ${cell(record.warnings.map((w) => `${w.rule} ${w.path}`).join(", "))} |`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

/** 判断を書き込むシート。decision と reason を人が書く(空のままなら取り込まない) */
export const ReviewSheetSchema = z.strictObject({
  examCode: z.string(),
  items: z.array(
    z.strictObject({
      id: DRAFT_ID,
      decision: z.enum(["approve", "release", "reject"]).nullable(),
      reason: REASON.nullable(),
    }),
  ),
});

export type ReviewSheet = z.infer<typeof ReviewSheetSchema>;

/** シートを作る。判断がすでにあるものは、その判断を書いておく(書き換えれば、新しい判断で置き換わる) */
export function buildReviewSheet(
  examCode: string,
  drafts: DraftsFile,
  decisions: DecisionsFile,
  plan?: SamplingPlan,
  skip: ReviewSkip = NO_SKIP,
): ReviewSheet {
  return {
    examCode,
    items: reviewTargets(drafts, decisions, plan, skip).map((d) => {
      const existing = decisions.decisions.find((x) => x.target === "draft" && x.id === d.id);
      return {
        id: d.id,
        decision: existing?.target === "draft" ? existing.decision : null,
        reason: existing?.reason ?? null,
      };
    }),
  };
}

export type SheetProblem = { index: number; code: "unknown-draft" | "missing-reason" | "release-not-held" };

/**
 * 書き込まれたシートから、判断を取り出す。判断のない行は飛ばす。
 * 知らない下書き、理由のない判断、保留でない下書きの保留の解除は、誤りとして場所(行の番号)と種類だけを返す。
 */
export function decisionsFromSheet(
  sheet: ReviewSheet,
  drafts: DraftsFile,
): { decisions: Decision[]; problems: SheetProblem[]; skipped: number } {
  const decisions: Decision[] = [];
  const problems: SheetProblem[] = [];
  let skipped = 0;
  sheet.items.forEach((item, index) => {
    if (item.decision === null) {
      skipped++;
      return;
    }
    const record = drafts.drafts.find((d) => d.id === item.id);
    if (record === undefined) problems.push({ index, code: "unknown-draft" });
    else if (item.reason === null) problems.push({ index, code: "missing-reason" });
    else if (item.decision === "release" && record.status !== "held")
      problems.push({ index, code: "release-not-held" });
    else decisions.push({ target: "draft", id: item.id, decision: item.decision, reason: item.reason });
  });
  return { decisions, problems, skipped };
}
