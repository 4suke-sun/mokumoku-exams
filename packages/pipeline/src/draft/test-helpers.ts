import type { ChoiceDraft } from "./schema.ts";

/** 通る下書き(テスト用の既定値。架空のサービス Widget Store の内容) */
export function choiceDraft(overrides: Partial<ChoiceDraft> = {}): ChoiceDraft {
  return {
    questionType: "single",
    questionText: "Widget Store で、1 つのアカウントがリージョンごとに作れるバケットの上限数はどれですか。",
    choices: [
      { key: "A", text: "10 個" },
      { key: "B", text: "100 個" },
      { key: "C", text: "1,000 個" },
      { key: "D", text: "上限はない" },
    ],
    correctAnswers: ["B"],
    explanation: "Widget Store では、アカウントがリージョンごとに作れるバケットは 100 個までと定められています。",
    factIds: ["f-aaaaaaaaaaaa"],
    ...overrides,
  };
}

/** 複数選択の下書き */
export function multipleDraft(overrides: Partial<ChoiceDraft> = {}): ChoiceDraft {
  return choiceDraft({
    questionType: "multiple",
    questionText: "Widget Store のバケットについて正しい説明を 2 つ選択してください。",
    choices: [
      { key: "A", text: "バケット名は、リージョンの中で一意でなければならない" },
      { key: "B", text: "バケットは、作成後に別のリージョンへ移せる" },
      { key: "C", text: "アカウントあたりの上限は、リージョンごとに数えられる" },
      { key: "D", text: "バケットには、オブジェクトを入れずに作成できる" },
      { key: "E", text: "バケットを作ると、自動で公開状態になる" },
    ],
    correctAnswers: ["A", "C"],
    ...overrides,
  });
}
