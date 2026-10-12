import { describe, expect, it } from "vitest";
import { findPublishedExam } from "./exam-data.ts";
import { joinCards, loadSummaryCards } from "./summary-data.ts";
import type { PublishedExam, Question } from "./types.ts";

const choice = (key: string) => ({ key, text: `選択肢 ${key}` });
const question = (id: string, over: Record<string, unknown> = {}): Question =>
  ({
    questionId: id,
    examCode: "T",
    domain: "domain1",
    questionType: "single",
    difficulty: "hard",
    questionText: "問題文",
    choices: [choice("A"), choice("B"), choice("C")],
    correctAnswers: ["B"],
    explanation: "解説",
    ...over,
  }) as Question;

describe("joinCards", () => {
  const file = (cards: { questionId: string; answers: string[] }[]) => ({
    cards: cards.map((c) => ({ ...c, question: "問い", point: "決め手" })),
  });

  it("カードと問題_分野・難易度・種類を問題から引き_正解の選択肢の本文を添える", () => {
    const cards = joinCards(file([{ questionId: "T-0001", answers: ["C", "A"] }]), [
      question("T-0001", { questionType: "multiple", correctAnswers: ["A", "C"] }),
    ]);
    expect(cards).toEqual([
      {
        questionId: "T-0001",
        domain: "domain1",
        difficulty: "hard",
        questionType: "multiple",
        question: "問い",
        // 選択肢の並びで返す(カードに書いた並びではなく)
        answers: [
          { key: "A", text: "選択肢 A" },
          { key: "C", text: "選択肢 C" },
        ],
        point: "決め手",
      },
    ]);
  });

  it("難易度のない問題_難易度の項目を持たない", () => {
    const [card] = joinCards(file([{ questionId: "T-0001", answers: ["B"] }]), [
      question("T-0001", { difficulty: undefined }),
    ]);
    expect(card && "difficulty" in card).toBe(false);
  });

  it("問題データにない問題・自由記述の問題_含めない", () => {
    const cards = joinCards(
      file([
        { questionId: "T-0001", answers: ["B"] },
        { questionId: "T-0002", answers: ["B"] },
        { questionId: "T-0003", answers: ["B"] },
      ]),
      [question("T-0001"), question("T-0003", { questionType: "free-text" })],
    );
    expect(cards.map((c) => c.questionId)).toEqual(["T-0001"]);
  });

  it("カードの並び_ファイルの並びのまま", () => {
    const cards = joinCards(
      file([
        { questionId: "T-0002", answers: ["B"] },
        { questionId: "T-0001", answers: ["B"] },
      ]),
      [question("T-0001"), question("T-0002")],
    );
    expect(cards.map((c) => c.questionId)).toEqual(["T-0002", "T-0001"]);
  });
});

describe("loadSummaryCards", () => {
  it("サンプル資格_要約カードを返し_正解の選択肢の本文を持つ", async () => {
    const exam = findPublishedExam("EX-SMP-XX");
    if (!exam) throw new Error("サンプル資格がありません");
    const cards = await loadSummaryCards(exam);
    expect(cards?.length).toBeGreaterThan(0);
    expect(cards?.every((c) => c.answers.length > 0 && c.answers.every((a) => a.text !== ""))).toBe(true);
  });

  it("要約カードのファイルがない資格_null(入口を出さない)", async () => {
    expect(await loadSummaryCards({ examCode: "NOFILE" } as PublishedExam)).toBeNull();
  });
});
