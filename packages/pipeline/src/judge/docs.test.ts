import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { hasDescription } from "../reasons/catalog.ts";
import { PASSING } from "../scorecard/profiles.ts";
import { readCriteria } from "./criteria.ts";
import { JUDGE_CODES, JUDGE_VERDICTS, REWRITABLE_CODES, UNPUBLISH_CODES } from "./schema.ts";

const repoRoot = resolve(import.meta.dirname, "../../../..");
const read = (path: string) => readFileSync(resolve(repoRoot, path), "utf8");

describe("判定の基準の文書", () => {
  it.each(["AWS-CLF-C02", "AWS-DVA-C02", "AWS-AIB-C01", "AWS-SOA-C03", "DBX-DEA-2605"])(
    "%s_判定の基準の節に_機械の観点と LLM の観点があり_観点 J1〜J5 の行がそろい_合格点が実装と同じ",
    (code) => {
      const criteria = readCriteria(repoRoot, code);
      expect(criteria, code).not.toBeNull();
      const text = criteria?.text ?? "";
      expect(text).toContain("### 機械の観点");
      expect(text).toContain("### LLM の観点");
      for (const id of ["J1", "J2", "J3", "J4", "J5"]) expect(text, id).toMatch(new RegExp(`^\\| ${id} \\|`, "m"));
      expect(text).toContain(`問題 1 問が ${PASSING.question} 点`);
      expect(text).toContain(`束が ${PASSING.batch} 点`);
    },
  );

  it.each(["AWS-CLF-C02", "AWS-DVA-C02", "AWS-AIB-C01", "AWS-SOA-C03", "DBX-DEA-2605"])(
    "%s_機械の観点の節に帯の値を重ねて書かない(値の食い違いを防ぐ)",
    (code) => {
      const text = readCriteria(repoRoot, code)?.text ?? "";
      const machine = text.slice(text.indexOf("### 機械の観点"), text.indexOf("### LLM の観点"));
      // 帯の値(字数・倍率・割合)は、「1. 要点」の表にだけある。節には、合格点以外の数値の表現を置かない
      expect(machine).not.toMatch(/\d+〜\d+/);
      expect(machine).not.toMatch(/\d+ 倍/);
      expect(machine).not.toMatch(/\d+%/);
    },
  );

  it("書き方の指針の README_判定と理由コードの表が、実装の一覧と同じ", () => {
    const readme = read("docs/exam-style/README.md");
    const section = readme.slice(readme.indexOf("## 判定の基準"));
    for (const verdict of JUDGE_VERDICTS) expect(section, verdict).toMatch(new RegExp(`^\\| \`${verdict}\` \\|`, "m"));
    for (const code of JUDGE_CODES) {
      const row = new RegExp(`^\\| \`${code}\` \\|.*\\| \`(rewritable|unpublish)\` \\|$`, "m").exec(section);
      expect(row, code).not.toBeNull();
      const allowed = (REWRITABLE_CODES as readonly string[]).includes(code) ? "rewritable" : "unpublish";
      expect(row?.[1], code).toBe(allowed);
    }
    expect(UNPUBLISH_CODES.length).toBe(2);
  });

  it("判定役の定義_理由コードと判定の一覧がそろい_場所の書き方が実装と同じ", () => {
    const def = read(".claude/agents/question-judge.md");
    for (const code of JUDGE_CODES) expect(def, code).toContain(`\`${code}\``);
    for (const verdict of JUDGE_VERDICTS) expect(def, verdict).toContain(`\`${verdict}\``);
    expect(def).toContain("choices.B");
  });

  it("理由コードの説明_すべての判定の理由コードに、完全一致の説明がある", () => {
    for (const code of JUDGE_CODES) expect(hasDescription(`judge:${code}`), code).toBe(true);
  });

  it("パイプラインを回す手順_判定と判定役の評価の手順がある", () => {
    const skill = read(".claude/skills/pipeline-run/SKILL.md");
    expect(skill).toContain("judge <資格コード> --import");
    expect(skill).toContain("judge-eval <資格コード> --import");
  });
});
