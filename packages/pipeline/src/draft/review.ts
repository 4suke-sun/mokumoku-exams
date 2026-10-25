import { z } from "zod";
import { REASON } from "../collect/ledger.ts";
import { type Decision, type DecisionsFile, DRAFT_ID, draftDecision } from "../decisions/decisions.ts";
import type { FactsFile } from "../facts/schema.ts";
import type { SamplingPlan } from "../sampling/plan.ts";
import type { ProvenanceFile } from "./provenance.ts";
import { evidenceLocations } from "./revise.ts";
import type { DraftRecord, DraftsFile } from "./store.ts";

/**
 * 人が通過と保留の下書き(と、人が却下した下書き)をすべて確かめるための表と、判断を書き込むシート。
 * 表には、設問文・選択肢・正答・解説、根拠にした事実カードの主張(出典の言い換え)と節、検証役が読む根拠の節の場所(出典の URL・節の名前・見出し)、
 * 出典の URL、警告と保留の理由コード、直した下書きの直す前の下書きの ID を載せる。
 * 取得した本文の写しは載せない。表とシートは作業用の置き場に出し、コミットしない。
 */

/** 確認の済み・未済。承認か却下の判断があるものを、確認済みとする */
export interface ReviewCounts {
  total: number;
  approved: number;
  rejected: number;
  pending: number;
}

/** 確認の対象: 不採用でない下書き(人が却下したものは、確認済みとして数える) */
export function reviewTargets(drafts: DraftsFile, decisions: DecisionsFile, plan?: SamplingPlan): DraftRecord[] {
  // 抜き取りのとき、通過した下書きのうち確認しないものは、対象にしない(人がすでに判断したものは、確認済みとして残す)
  const skipped = plan?.mode === "sample" ? new Set(plan.draft.notReviewed) : new Set<string>();
  return drafts.drafts.filter(
    (d) =>
      (d.status !== "rejected" || draftDecision(decisions, d.id) === "reject") &&
      (!skipped.has(d.id) || draftDecision(decisions, d.id) !== undefined),
  );
}

export function reviewCounts(drafts: DraftsFile, decisions: DecisionsFile, plan?: SamplingPlan): ReviewCounts {
  const targets = reviewTargets(drafts, decisions, plan);
  const approved = targets.filter((d) => draftDecision(decisions, d.id) === "approve").length;
  const rejected = targets.filter((d) => draftDecision(decisions, d.id) === "reject").length;
  return { total: targets.length, approved, rejected, pending: targets.length - approved - rejected };
}

/** Markdown の表の 1 マスに入れる。縦棒と改行を、表を壊さない形にする */
function cell(text: string): string {
  return text.replace(/\|/g, "\\|").replace(/\r?\n/g, "<br>");
}

/** 下書きの確認用の表(Markdown)。1 件を 1 つの節にし、項目を表で並べる */
export function renderDraftReview(
  examCode: string,
  drafts: DraftsFile,
  facts: FactsFile,
  provenance: ProvenanceFile,
  decisions: DecisionsFile,
  plan?: SamplingPlan,
): string {
  const counts = reviewCounts(drafts, decisions, plan);
  const lines = [
    `# 下書きの確認(${examCode})`,
    "",
    `対象 ${counts.total} 件(承認 ${counts.approved} 件、却下 ${counts.rejected} 件、未済 ${counts.pending} 件)。`,
    ...(plan?.mode === "sample"
      ? [
          `抜き取りで確認する(率 ${plan.rate}、種 ${plan.seed})。通過した下書き ${plan.draft.eligible} 件のうち、確認するもの ${plan.draft.reviewed.length} 件、確認しないもの ${plan.draft.notReviewed.length} 件。保留は全件を確認する。`,
        ]
      : []),
    "判断は、同じ置き場の review-sheet.json に書き、`draft <試験コード> --decide` で取り込む。",
    "",
  ];
  for (const record of reviewTargets(drafts, decisions, plan)) {
    const d = record.draft;
    const decision = draftDecision(decisions, record.id) ?? "未済";
    lines.push(`## ${record.id}`, "", "| 項目 | 内容 |", "| --- | --- |");
    lines.push(`| 状態 | ${record.status}(人の判断: ${decision}) |`);
    lines.push(`| 分野・難易度・種別 | ${record.domain} / ${record.difficulty} / ${d?.questionType ?? "-"} |`);
    if (record.revisionOf !== undefined) lines.push(`| 直す前の下書き | ${record.revisionOf} |`);
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
): ReviewSheet {
  return {
    examCode,
    items: reviewTargets(drafts, decisions, plan).map((d) => {
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
