import { describe, expect, it } from "vitest";
import {
  checkIndex,
  checkLesson,
  checkLessons,
  INDEX_END,
  INDEX_START,
  renderIndex,
  updateIndex,
} from "./lessons-check.ts";

const good = (title = "題") => `# ${title}\n\n## 注意すること\n\n規則。\n\n## 理由\n\n理由。\n\n## 対処\n\n対処。\n`;

describe("checkLesson", () => {
  it("正しい書式は通す", () => {
    expect(checkLesson({ file: "0001-sample-lesson.md", text: good("題の例") })).toEqual({
      title: "題の例",
      errors: [],
    });
  });

  it("ファイル名の形を検査する", () => {
    expect(checkLesson({ file: "1-bad.md", text: good() }).errors).toHaveLength(1);
    expect(checkLesson({ file: "0001-Bad_Name.md", text: good() }).errors).toHaveLength(1);
  });

  it("1 行目が「# 題」でないとき", () => {
    const r = checkLesson({ file: "0001-a.md", text: good().replace("# 題", "題") });
    expect(r.title).toBeNull();
    expect(r.errors[0]).toMatch(/1 行目が「# 題」の形ではありません/);
  });

  it("見出しの欠け・順序違いを止める", () => {
    const missing = good().replace("## 理由\n\n理由。\n\n", "");
    expect(checkLesson({ file: "0001-a.md", text: missing }).errors[0]).toMatch(/の順になっていません/);
    const swapped = "# 題\n\n## 理由\n\nあ。\n\n## 注意すること\n\nい。\n\n## 対処\n\nう。\n";
    expect(checkLesson({ file: "0001-a.md", text: swapped }).errors[0]).toMatch(/の順になっていません/);
  });

  it("空の節を止める", () => {
    const empty = good().replace("理由。", "");
    expect(checkLesson({ file: "0001-a.md", text: empty }).errors).toEqual(["0001-a.md:7: 「理由」の節が空です"]);
  });

  it("出来事を語る書き方を、場所と種類だけで止める", () => {
    const text = good().replace("規則。", "先日、値を出力してしまった。");
    const errors = checkLesson({ file: "0001-a.md", text }).errors;
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.every((e) => /^0001-a\.md:\d+: 出来事を語る書き方\(/.test(e))).toBe(true);
    expect(errors.join()).not.toContain("値を出力");
  });

  it("インラインコードとコードブロックの中は、書き方の検査の対象にしない", () => {
    const text = good().replace("規則。", "`してしまった` という語は使わない。\n\n```text\n先日の例\n```");
    expect(checkLesson({ file: "0001-a.md", text }).errors).toEqual([]);
  });

  it("~~~ とインデントされたフェンスの中も、書き方の検査の対象にしない", () => {
    const text = good().replace("規則。", "~~~text\n先日の例\n~~~\n\n  ```text\n  先日の例\n  ```");
    expect(checkLesson({ file: "0001-a.md", text }).errors).toEqual([]);
  });

  it("規則として書いた現在形は通す", () => {
    const text = good().replace("規則。", "値を出力すると、ログに残る。固定の文言を出す。");
    expect(checkLesson({ file: "0001-a.md", text }).errors).toEqual([]);
  });
});

describe("checkLessons", () => {
  it("番号の重複を止める", () => {
    const { errors } = checkLessons([
      { file: "0001-a.md", text: good() },
      { file: "0001-b.md", text: good() },
    ]);
    expect(errors).toEqual(["0001-b.md: 番号 0001 が 0001-a.md と重複しています"]);
  });

  it("番号順の一覧を返す", () => {
    const { lessons } = checkLessons([
      { file: "0002-b.md", text: good("B") },
      { file: "0001-a.md", text: good("A") },
    ]);
    expect(lessons.map((l) => l.number)).toEqual(["0001", "0002"]);
  });
});

describe("一覧", () => {
  const lessons = [{ file: "0001-a.md", number: "0001", title: "題 A" }];
  const readme = (inner: string) => `前\n${INDEX_START}\n${inner}\n${INDEX_END}\n後\n`;

  it("一覧を作る。無いときは(まだありません)", () => {
    expect(renderIndex(lessons)).toBe("- [0001 題 A](./0001-a.md)");
    expect(renderIndex([])).toBe("(まだありません)");
  });

  it("マーカーの内側だけを置き換える", () => {
    expect(updateIndex(readme("古い"), lessons)).toBe(readme("- [0001 題 A](./0001-a.md)"));
  });

  it("マーカーが無いときは null", () => {
    expect(updateIndex("マーカーなし", lessons)).toBeNull();
  });

  it("最新でなければ止め、最新なら通す", () => {
    expect(checkIndex(readme("古い"), lessons)).toHaveLength(1);
    expect(checkIndex(readme("- [0001 題 A](./0001-a.md)"), lessons)).toEqual([]);
    expect(checkIndex("マーカーなし", lessons)[0]).toMatch(/マーカー/);
  });
});
