import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listExams, listPublishedExams, loadQuestions, visibleExams } from "./exam-data.ts";

describe("visibleExams", () => {
  const exams = listExams();

  it("本番のビルド_動作確認用の架空の資格を出さない", () => {
    const visible = visibleExams(exams, false);
    expect(visible.some((exam) => exam.vendor === "Example")).toBe(false);
    expect(visible.map((exam) => exam.examCode)).toEqual(
      exams.filter((exam) => exam.vendor !== "Example").map((exam) => exam.examCode),
    );
  });

  it("開発とテスト_動作確認用の架空の資格も出す", () => {
    expect(visibleExams(exams, true)).toEqual(exams);
    expect(exams.some((exam) => exam.vendor === "Example")).toBe(true);
  });
});

describe("loadQuestions と非公開の問題", () => {
  const dataDir = join(import.meta.dirname, "../../../../data");
  const unpublishedIds = readdirSync(dataDir)
    .filter((name) => /^unpublished\..+\.json$/.test(name))
    .flatMap((name) => {
      const file = JSON.parse(readFileSync(join(dataDir, name), "utf8")) as {
        entries?: { question?: { questionId?: string } }[];
      };
      return (file.entries ?? []).flatMap((e) => (e.question?.questionId ? [e.question.questionId] : []));
    });

  it("非公開のファイルがある_公開中の資格の問題に、その問題を含まない(ファイルがない間は、空の検査)", async () => {
    const loaded = (await Promise.all(listPublishedExams().map((exam) => loadQuestions(exam)))).flat();
    const ids = new Set(loaded.map((q) => q.questionId));
    for (const id of unpublishedIds) expect(ids.has(id), id).toBe(false);
    expect(loaded.length).toBeGreaterThan(0);
  });

  it("バンドラが取り込むファイル(questions.*.json)_公開中の資格の問題データだけで_余分なファイルがない", () => {
    // 動的な import の `questions.${コード}.json` は、data/ の questions.*.json すべてを取り込む対象になる。
    // 非公開の問題を `questions.<コード>.unpublished.json` のような名前で置くと、配信に載る
    const allowed = new Set(listPublishedExams().map((exam) => `questions.${exam.examCode.toLowerCase()}.json`));
    const bundled = readdirSync(dataDir).filter((name) => /^questions\..*\.json$/.test(name));
    for (const name of bundled) expect(allowed.has(name), name).toBe(true);
  });

  it("問題データのファイル名_アプリが読む questions. と、読まない unpublished. が分かれている", () => {
    const names = readdirSync(dataDir);
    for (const exam of listPublishedExams()) {
      expect(names).toContain(`questions.${exam.examCode.toLowerCase()}.json`);
    }
    for (const name of names.filter((n) => n.startsWith("unpublished."))) {
      expect(name.startsWith("questions.")).toBe(false);
    }
  });
});
