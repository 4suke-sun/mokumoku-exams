import { CONTACT_CATEGORIES, type FeedbackRequest, QUESTION_CATEGORIES } from "./schema.ts";

/** 起票する Issue の題・本文・ラベル */
export type FeedbackIssue = { title: string; body: string; labels: string[] };

const CONTACT_LABELS: Record<keyof typeof CONTACT_CATEGORIES, string[]> = {
  bug: ["user", "bug"],
  improvement: ["user", "feat"],
  feature: ["user", "feat"],
  other: ["user"],
};

/**
 * 利用者の書いた内容を、コードブロックに入れる。コードブロックの中では、`@名前` のメンション、`#番号` の参照、リンク、HTML が働かない。
 * 囲みは、内容に含まれるバッククォートの連続より長くして、内容で囲みを閉じられないようにする。
 */
export function fence(text: string): string {
  const longest = Math.max(0, ...[...text.matchAll(/`+/g)].map((match) => match[0].length));
  const marker = "`".repeat(Math.max(3, longest + 1));
  return `${marker}text\n${text}\n${marker}`;
}

/**
 * 送信の内容から、Issue を作る。題は固定の形で、利用者の入力を使わない。本文に、利用者の識別子とメールアドレスは入れない
 * (この関数は、それらを受け取らない)。
 */
export function buildFeedbackIssue(request: FeedbackRequest, appVersion: string): FeedbackIssue {
  const text = request.text.trim();
  const written = text ? fence(text) : "(なし)";
  if (request.form === "contact") {
    const category = CONTACT_CATEGORIES[request.category];
    // 資格コードは、サーバーで公開中の資格と照合した値(利用者の自由記述ではない)
    const { examCode } = request;
    return {
      title: examCode ? `お問い合わせ: ${category}(${examCode})` : `お問い合わせ: ${category}`,
      body: [
        "フォーム: お問い合わせ",
        `種類: ${category}`,
        ...(examCode ? [`資格コード: ${examCode}`] : []),
        `アプリの版: ${appVersion}`,
        "",
        "内容:",
        "",
        written,
      ].join("\n"),
      labels: CONTACT_LABELS[request.category],
    };
  }
  const category = QUESTION_CATEGORIES[request.category];
  return {
    title: `問題の誤り: ${request.examCode} ${request.questionId}(${category})`,
    body: [
      "フォーム: 問題の誤りの報告",
      `種類: ${category}`,
      `資格コード: ${request.examCode}`,
      `問題 ID: ${request.questionId}`,
      `アプリの版: ${appVersion}`,
      "",
      "補足:",
      "",
      written,
    ].join("\n"),
    labels: ["user", "data"],
  };
}
