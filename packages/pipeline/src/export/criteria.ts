import { isChoiceDraft } from "../draft/schema.ts";
import type { DraftRecord } from "../draft/store.ts";
import { type ServiceTargets, serviceStatus } from "../plan/services.ts";
import { resolveProfile } from "../scorecard/profiles.ts";
import { questionPasses, scoreQuestion } from "../scorecard/score.ts";
import { mentionedServices } from "../shared/services.ts";

/**
 * 基準を満たした下書きを、人の承認なしで書き出せるものとして選ぶ(設定 review.autoApprove に挙げた試験だけ)。
 * 基準: (1) 検証役の判定が合格、(2) 点数票の問題 1 問の得点が合格点以上で、止める項目の違反がない、
 * (3) 対象サービスの目標があるとき、出るサービスがすべて割合の上限を超えるものではない(一覧がなければ満たさない)。
 * 満たさない下書きは、これまでどおり人の承認が要る。来歴の検査は、書き出しの側で別に行う。
 */
export function criteriaAccepted(input: {
  drafts: readonly DraftRecord[];
  examCode: string;
  /** 対象サービスの目標(試験ごとの設定)。持たない試験は (3) を見ない */
  targets: ServiceTargets | undefined;
  /** 台帳の試験ガイドの対象サービスの一覧 */
  services: readonly string[];
  /** 公開済みの問題の本文(設問文と選択肢)。サービスの割合を数える */
  publishedTexts: readonly string[];
}): Set<string> {
  const { drafts, examCode, targets, services, publishedTexts } = input;
  const profile = resolveProfile(examCode);
  if (profile === null) return new Set();
  if (targets !== undefined && services.length === 0) return new Set();
  const candidates = drafts.filter(
    (d) => d.status === "passed" && d.draft !== null && isChoiceDraft(d.draft) && d.verification?.verdict === "pass",
  );
  const textOf = (d: DraftRecord) =>
    d.draft !== null && isChoiceDraft(d.draft)
      ? [d.draft.questionText, ...d.draft.choices.map((c) => c.text)].join("\n")
      : "";
  const status =
    targets === undefined ? null : serviceStatus([...publishedTexts, ...candidates.map(textOf)], services, targets);
  const accepted = new Set<string>();
  for (const d of candidates) {
    if (d.draft === null || !isChoiceDraft(d.draft)) continue;
    const draft = d.draft;
    const score = scoreQuestion(
      {
        id: d.id,
        type: draft.questionType,
        stem: draft.questionText,
        choices: draft.choices.map((c) => c.text),
        correct: draft.correctAnswers.map((a) => draft.choices.findIndex((c) => c.key === a)),
      },
      profile,
    );
    if (!questionPasses(score)) continue;
    if (status !== null) {
      const found = [...mentionedServices(textOf(d), services)];
      if (found.length > 0 && found.every((s) => status.above.includes(s))) continue;
    }
    accepted.add(d.id);
  }
  return accepted;
}
