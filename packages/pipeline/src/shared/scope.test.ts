import { describe, expect, it } from "vitest";
import { hasScopeLists, scopeFindings, scopeListsOf } from "./scope.ts";

const lists = {
  inScope: ["Amazon Bedrock", "Amazon SageMaker Clarify", "AWS Lambda"],
  outOfScope: ["Amazon SageMaker", "Amazon Kinesis"],
};

function q(stem: string, choices: string[], correct: number[]) {
  return { stem, choices, correct };
}

describe("範囲の検査", () => {
  it("対象のサービスだけが出る問題_何も見つけない", () => {
    const f = scopeFindings(q("Amazon Bedrock を使う場面です。", ["AWS Lambda", "Amazon Bedrock"], [1]), lists);
    expect(f).toEqual({ outOfScopeSubject: false, outOfScopeDistractor: false, unlisted: null });
  });

  it("対象外のサービスが設問文に出る_主題の逸脱", () => {
    const f = scopeFindings(q("Amazon Kinesis を使う場面です。", ["A", "B"], [0]), lists);
    expect(f.outOfScopeSubject).toBe(true);
  });

  it("対象外のサービスが正答の選択肢に出る_主題の逸脱", () => {
    const f = scopeFindings(q("どれを選びますか。", ["Amazon Kinesis", "AWS Lambda"], [0]), lists);
    expect(f.outOfScopeSubject).toBe(true);
    expect(f.outOfScopeDistractor).toBe(false);
  });

  it("対象外のサービスが誤答の選択肢だけに出る_誤答のみ", () => {
    const f = scopeFindings(q("どれを選びますか。", ["Amazon Kinesis", "AWS Lambda"], [1]), lists);
    expect(f).toEqual({ outOfScopeSubject: false, outOfScopeDistractor: true, unlisted: null });
  });

  it("対象の長い名前が対象外の短い名前を含む_長い名前を対象として数える", () => {
    const f = scopeFindings(q("どれを選びますか。", ["Amazon SageMaker Clarify", "AWS Lambda"], [0]), lists);
    expect(f.outOfScopeSubject).toBe(false);
  });

  it("一覧にないサービスらしい名前_一覧にない名前として見つける", () => {
    const f = scopeFindings(q("AWS Glue を使う場面です。", ["AWS Lambda", "Amazon Bedrock"], [0]), lists);
    expect(f.unlisted).toBe("questionText");
  });

  it("一覧にない名前が選択肢だけに出る_場所は選択肢", () => {
    const f = scopeFindings(q("どれを選びますか。", ["AWS Glue", "Amazon Bedrock"], [1]), lists);
    expect(f.unlisted).toBe("choices");
  });

  it("一覧のサービスの続きに語が付く名前_一覧にない名前にしない", () => {
    const f = scopeFindings(q("Amazon Bedrock Guardrails を使う場面です。", ["AWS Lambda", "A"], [0]), lists);
    expect(f.unlisted).toBeNull();
  });

  it("会社名や一般名_一覧にない名前にしない", () => {
    const f = scopeFindings(q("Amazon Web Services の AWS Cloud を使う場面です。", ["AWS Lambda", "A"], [0]), lists);
    expect(f.unlisted).toBeNull();
  });

  it("対象外の一覧だけがある試験_一覧にない名前は見ない", () => {
    const f = scopeFindings(q("AWS Glue を使う場面です。", ["Amazon Kinesis", "A"], [1]), {
      inScope: [],
      outOfScope: ["Amazon Kinesis"],
    });
    expect(f).toEqual({ outOfScopeSubject: false, outOfScopeDistractor: true, unlisted: null });
  });

  it("一覧が両方とも空_何も見つけない", () => {
    const f = scopeFindings(q("Amazon Kinesis を使う場面です。", ["A", "B"], [0]), { inScope: [], outOfScope: [] });
    expect(f).toEqual({ outOfScopeSubject: false, outOfScopeDistractor: false, unlisted: null });
  });
});

describe("台帳の記録から一覧を取る", () => {
  it("記録がない_空の一覧で、検査は成り立たない", () => {
    expect(hasScopeLists(scopeListsOf(null))).toBe(false);
    expect(hasScopeLists(scopeListsOf({}))).toBe(false);
  });

  it("対象外の一覧だけがある_検査は成り立つ", () => {
    expect(hasScopeLists(scopeListsOf({ excludedServices: ["Amazon Kinesis"] }))).toBe(true);
  });
});
