import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const script = fileURLToPath(new URL("./validate-summary-data.ts", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));
const created: string[] = [];

afterEach(() => {
  for (const dir of created.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDir(files: Record<string, unknown>): string {
  const dir = mkdtempSync(join(tmpdir(), "summary-data-"));
  created.push(dir);
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), typeof content === "string" ? content : JSON.stringify(content));
  }
  return dir;
}

const run = (...args: string[]) => spawnSync("node", [script, ...args], { cwd: root, encoding: "utf8" });

const exams = { exams: [{ examCode: "SAMPLE", status: "published" }] };
const questions = {
  examCode: "SAMPLE",
  questions: [
    { questionId: "SAMPLE-0001", questionType: "single", correctAnswers: ["B"] },
    { questionId: "SAMPLE-0002", questionType: "free-text" },
  ],
};
const summary = (over: Record<string, unknown> = {}) => ({
  examCode: "SAMPLE",
  cards: [{ questionId: "SAMPLE-0001", question: "問い", answers: ["B"], point: "決め手", ...over }],
});

describe("validate-summary-data", () => {
  it("リポジトリの data/ が、検査を通る", () => {
    const r = run();
    expect(r.status, r.stderr).toBe(0);
  });

  it("問題の正解と一致している_通る", () => {
    const dir = makeDir({ "exams.json": exams, "questions.sample.json": questions, "summary.sample.json": summary() });
    expect(run(dir).status).toBe(0);
  });

  it("答えが問題の正解と違う_失敗にする", () => {
    const dir = makeDir({
      "exams.json": exams,
      "questions.sample.json": questions,
      "summary.sample.json": summary({ answers: ["A"] }),
    });
    const r = run(dir);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/cards\[0\]\.answers: 問題の正解と一致しません/);
  });

  it("問題データにない問題・自由記述の問題_失敗にする", () => {
    for (const questionId of ["SAMPLE-0099", "SAMPLE-0002"]) {
      const dir = makeDir({
        "exams.json": exams,
        "questions.sample.json": questions,
        "summary.sample.json": summary({ questionId }),
      });
      expect(run(dir).status).toBe(1);
    }
  });

  it("JSON として読めないときは、入力の一部を載せずに失敗にする", () => {
    const r = run(makeDir({ "exams.json": exams, "summary.sample.json": '{ "目印XYZ" 壊れた' }));
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/summary\.sample\.json: JSON として読めません/);
    expect(r.stderr).not.toContain("目印XYZ");
  });

  it("要約カードのファイルがない_通る(任意)", () => {
    expect(run(makeDir({ "exams.json": exams, "questions.sample.json": questions })).status).toBe(0);
  });

  it("引数が多いとき、成功にしない", () => {
    expect(run("a", "b").status).toBe(2);
  });
});
