/**
 * 問題の範囲の検査(ADR 0024)。試験ガイドの対象サービス・対象外サービスの一覧と、問題の本文のサービス名を照らす。
 * 名前の照合は shared/services.ts(文字列の一致による目安)。取り込みと点数票が呼ぶ。
 */
import { mentionedServices } from "./services.ts";

/** 範囲の検査に使う一覧(台帳の試験ガイドの対象サービスと対象外サービス) */
export interface ScopeLists {
  inScope: readonly string[];
  outOfScope: readonly string[];
}

/** 検査する問題。正答は選択肢の添字 */
export interface ScopeInput {
  stem: string;
  choices: readonly string[];
  correct: readonly number[];
}

export interface ScopeFindings {
  /** 対象外のサービスが、設問文か正答の選択肢に出る */
  outOfScopeSubject: boolean;
  /** 対象外のサービスが、誤答の選択肢にだけ出る(設問文・正答には出ない) */
  outOfScopeDistractor: boolean;
  /** 対象にも対象外にもない、サービスらしい名前が出る(一覧の抽出漏れか新しい名前。人が確かめる)。出た場所は、設問文が先 */
  unlisted: "questionText" | "choices" | null;
}

/** 台帳の試験ガイドの記録から、検査に使う一覧を取る(古い記録、示さない試験は空) */
export function scopeListsOf(
  guide: { services?: readonly string[]; excludedServices?: readonly string[] } | null | undefined,
): ScopeLists {
  return { inScope: guide?.services ?? [], outOfScope: guide?.excludedServices ?? [] };
}

/** 一覧が両方とも空なら、範囲の検査は成り立たない(何も見つけない) */
export function hasScopeLists(lists: ScopeLists): boolean {
  return lists.inScope.length > 0 || lists.outOfScope.length > 0;
}

/** サービスの名前らしい表記: 「Amazon」か「AWS」で始まり、大文字で始まる語が続く(英数字のみの語) */
const SERVICE_LIKE = /\b(?:Amazon|AWS) [A-Z][A-Za-z0-9]*(?: [A-Z][A-Za-z0-9]*)*/g;

/** サービスではない、よく出る表記(会社名・一般名) */
const NOT_SERVICES: ReadonlySet<string> = new Set([
  "Amazon Web Services",
  "AWS Cloud",
  "AWS Region",
  "AWS Regions",
  "AWS Account",
  "AWS Accounts",
]);

/**
 * 問題の本文のサービス名を、対象・対象外の一覧と照らす。一覧が両方とも空なら、何も見つけない。
 * 対象のサービスだけが一覧にあるとき(対象外が空)も、一覧にない名前は見つける。
 */
export function scopeFindings(input: ScopeInput, lists: ScopeLists): ScopeFindings {
  const none: ScopeFindings = { outOfScopeSubject: false, outOfScopeDistractor: false, unlisted: null };
  if (!hasScopeLists(lists)) return none;
  const all = [...lists.inScope, ...lists.outOfScope];
  const excluded = new Set(lists.outOfScope);
  const outOf = (text: string) => [...mentionedServices(text, all)].some((s) => excluded.has(s));
  const correct = new Set(input.correct);
  const subjectTexts = [input.stem, ...input.choices.filter((_, i) => correct.has(i))];
  const distractorTexts = input.choices.filter((_, i) => !correct.has(i));
  const outOfScopeSubject = subjectTexts.some(outOf);
  const outOfScopeDistractor = !outOfScopeSubject && distractorTexts.some(outOf);
  // 一覧にない名前は、対象の一覧があるときだけ見る(対象外だけの一覧では、対象にあるかを言えない)
  const hasUnlisted = (text: string) =>
    (text.match(SERVICE_LIKE) ?? []).some((name) => !NOT_SERVICES.has(name) && mentionedServices(name, all).size === 0);
  const unlisted =
    lists.inScope.length === 0
      ? null
      : hasUnlisted(input.stem)
        ? "questionText"
        : input.choices.some(hasUnlisted)
          ? "choices"
          : null;
  return { outOfScopeSubject, outOfScopeDistractor, unlisted };
}
