import { describe, expect, it } from "vitest";
import { validateHelpData } from "./validate.ts";

const context = { routes: ["/", "/exams"], examCodes: ["SAMPLE"] };
const section = (over: Record<string, unknown> = {}) => ({
  id: "start",
  title: "はじめに",
  body: "本文です。",
  ...over,
});

describe("validateHelpData", () => {
  it("正しいデータ_指摘なし", () => {
    const data = { sections: [section({ links: [{ label: "資格", href: "/exams" }] })] };
    expect(validateHelpData(data, context)).toEqual([]);
  });

  it("ファイルがない_その旨を報告する", () => {
    expect(validateHelpData(null, context)).toEqual(["help.json: ファイルがありません"]);
  });

  it("必須項目がない_場所と種類だけを報告する", () => {
    const errors = validateHelpData({ sections: [{ id: "start", title: "はじめに" }] }, context);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("sections[0].body");
  });

  it("本文が空白だけ_指摘する", () => {
    expect(validateHelpData({ sections: [section({ body: "   " })] }, context)).toHaveLength(1);
  });

  it("未知の項目_指摘する", () => {
    expect(validateHelpData({ sections: [section({ extra: 1 })] }, context)).toHaveLength(1);
  });

  it("ID の重複_指摘する", () => {
    const errors = validateHelpData({ sections: [section(), section()] }, context);
    expect(errors).toEqual(["help.json: sections[1].id: ID が重複しています"]);
  });

  it("セクションがない_指摘する", () => {
    expect(validateHelpData({ sections: [] }, context)).toHaveLength(1);
  });

  it("画面がないアプリ内リンク_リンク切れとして報告する", () => {
    const data = { sections: [section({ links: [{ label: "履歴", href: "/history" }] })] };
    expect(validateHelpData(data, context)).toEqual([
      "help.json: sections[0].links[0].href: リンク先の画面がありません(リンク切れ)",
    ]);
  });

  it("公開中の資格のページ_リンクできる", () => {
    const ok = { sections: [section({ links: [{ label: "サンプル", href: "/exams/SAMPLE" }] })] };
    const broken = { sections: [section({ links: [{ label: "別", href: "/exams/OTHER" }] })] };
    expect(validateHelpData(ok, context)).toEqual([]);
    expect(validateHelpData(broken, context)).toHaveLength(1);
  });

  it("https の外部リンク_許可し_http や javascript: は許可しない", () => {
    const https = { sections: [section({ links: [{ label: "外部", href: "https://example.com/a" }] })] };
    expect(validateHelpData(https, context)).toEqual([]);
    for (const href of [
      "http://example.com",
      "javascript:alert(1)",
      "//example.com",
      "exams",
      "/exams/../history",
      "https://user@example.com/",
    ]) {
      const data = { sections: [section({ links: [{ label: "x", href }] })] };
      expect(validateHelpData(data, context)).toHaveLength(1);
    }
  });

  it("報告に入力の値を含めない", () => {
    const data = { sections: [section({ links: [{ label: "x", href: "javascript:secret-value" }] })] };
    expect(validateHelpData(data, context).join("\n")).not.toContain("secret-value");
  });
});
