// @vitest-environment jsdom
import type { CodeDrillProblem } from "@mokumoku-exams/data-schema/code-drill-data/schema";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CodeDrillList } from "./code-drill-list.tsx";
import { CodeDrillPlayer } from "./code-drill-player.tsx";

const problem = {
  id: "SAMPLE-CD-0001",
  domain: "domain1",
  language: "sql",
  title: "行を絞る",
  prompt: "`sales` から行を絞ります。",
  template: "SELECT * FROM sales {{1}} amount {{2}} 100",
  blanks: [{ answer: "WHERE" }, { answer: ">" }],
  distractors: [
    { text: "HAVING", blank: 1, outcome: { kind: "error", text: "集計のない文では使えません。" } },
    { text: ">=", blank: 2, outcome: { kind: "different-result", text: "100 の行も入ります。" } },
  ],
  solutions: ["SELECT * FROM sales WHERE amount > 100"],
  result: { text: "100 を超える行だけが返ります。" },
  explanation: "`WHERE` で行を絞ります。",
  references: [{ title: "出典", url: "https://docs.databricks.com/" }],
  status: "verified",
} as CodeDrillProblem;

async function renderPlayer() {
  render(<CodeDrillPlayer problem={problem} domainName="分野 1" basePath="/exams/TEST/code-drill" nextHref={null} />);
  await act(async () => {});
}
const fragment = (text: string) =>
  within(screen.getByRole("list", { name: "断片" })).getByRole("button", { name: text });

describe("CodeDrillPlayer(穴埋め)", () => {
  it("全部の穴が埋まるまで回答できず_断片は先頭の空いた穴から入る", async () => {
    await renderPlayer();
    const submit = screen.getByRole("button", { name: "回答する" });
    expect(submit.hasAttribute("disabled")).toBe(true);
    fireEvent.click(fragment("HAVING"));
    expect(screen.getByRole("button", { name: "穴 1: HAVING" })).toBeTruthy();
    expect(fragment("HAVING").hasAttribute("disabled")).toBe(true);
    fireEvent.click(fragment(">"));
    expect(submit.hasAttribute("disabled")).toBe(false);
  });

  it("穴を押して外し_すべてクリアで空に戻る", async () => {
    await renderPlayer();
    fireEvent.click(fragment("HAVING"));
    fireEvent.click(screen.getByRole("button", { name: "穴 1: HAVING" }));
    expect(screen.getByRole("button", { name: "穴 1: 空" })).toBeTruthy();
    fireEvent.click(fragment("WHERE"));
    fireEvent.click(screen.getByRole("button", { name: "すべてクリア" }));
    expect(screen.getByRole("button", { name: "穴 1: 空" })).toBeTruthy();
  });

  it("不正解で回答する_正誤と_誤りの断片の実行するとどうなるか_正解のコードと解説を出す", async () => {
    await renderPlayer();
    fireEvent.click(fragment("HAVING"));
    fireEvent.click(fragment(">"));
    fireEvent.click(screen.getByRole("button", { name: "回答する" }));
    expect(screen.getByRole("status").textContent).toContain("× 不正解です");
    expect(document.body.textContent).toContain("実行すると: エラーになります");
    expect(document.body.textContent).toContain("集計のない文では使えません。");
    expect(screen.getByLabelText("正解のコード").textContent).toBe("SELECT * FROM sales WHERE amount > 100");
    expect(screen.getByRole("button", { name: "穴 1: HAVING。不正解" })).toBeTruthy();
  });

  it("ヒント_押すたびに 1 か所ずつ正解が入り_使った回数を出す", async () => {
    await renderPlayer();
    fireEvent.click(screen.getByRole("button", { name: "ヒント" }));
    expect(screen.getByRole("button", { name: "穴 1: WHERE(ヒント)" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "ヒント" }));
    expect(screen.getByRole("button", { name: "ヒント" }).hasAttribute("disabled")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "回答する" }));
    expect(screen.getByRole("status").textContent).toContain("○ 正解です");
    expect(screen.getByRole("status").textContent).toContain("ヒントを 2 回使いました");
  });
});

describe("CodeDrillPlayer(ヒントと正誤)", () => {
  it("自分で正解を入れても_ヒントは押せるままで_押せるかどうかで正誤が分からない", async () => {
    await renderPlayer();
    fireEvent.click(fragment("WHERE"));
    fireEvent.click(fragment(">"));
    expect(screen.getByRole("button", { name: "ヒント" }).hasAttribute("disabled")).toBe(false);
  });
});

describe("CodeDrillPlayer(全文入力)", () => {
  function switchToText() {
    fireEvent.click(screen.getByRole("tab", { name: "全文入力" }));
    return screen.getByRole("textbox", { name: "コード全体を入力してください" });
  }

  it("空のうちは回答できず_正規化して一致すれば正解", async () => {
    await renderPlayer();
    const box = switchToText();
    expect(screen.getByRole("button", { name: "回答する" }).hasAttribute("disabled")).toBe(true);
    fireEvent.change(box, { target: { value: "select *\nfrom sales\nwhere amount > 100;" } });
    fireEvent.click(screen.getByRole("button", { name: "回答する" }));
    expect(screen.getByRole("status").textContent).toContain("○ 正解です");
  });

  it("一致しない_入力したコードの結果は断定せず_正解のコードと比べるよう伝える", async () => {
    await renderPlayer();
    fireEvent.change(switchToText(), { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByRole("button", { name: "回答する" }));
    expect(screen.getByRole("status").textContent).toContain("× 不正解です");
    expect(document.body.textContent).toContain("入力したコードの結果は示せません");
  });

  it("入力したコード_HTML として解釈しない", async () => {
    await renderPlayer();
    fireEvent.change(switchToText(), { target: { value: "<img src=x onerror=alert(1)><b>太字</b>" } });
    fireEvent.click(screen.getByRole("button", { name: "回答する" }));
    expect(document.querySelector("img")).toBeNull();
    expect(document.querySelector("b")).toBeNull();
  });

  it("ヒント_1 回目は穴を伏せたコード_2 回目で最初の穴を明かす_入力欄は書き換えない", async () => {
    await renderPlayer();
    const box = switchToText();
    fireEvent.change(box, { target: { value: "書きかけ" } });
    fireEvent.click(screen.getByRole("button", { name: "ヒント" }));
    expect(screen.getByLabelText("ヒントのコード").textContent).toBe(
      "SELECT * FROM sales ［穴 1］ amount ［穴 2］ 100",
    );
    fireEvent.click(screen.getByRole("button", { name: "ヒント" }));
    expect(screen.getByLabelText("ヒントのコード").textContent).toBe("SELECT * FROM sales WHERE amount ［穴 2］ 100");
    expect((box as HTMLTextAreaElement).value).toBe("書きかけ");
  });

  it("穴埋めと全文入力_切り替えても入力をそれぞれ保つ", async () => {
    await renderPlayer();
    fireEvent.click(fragment("HAVING"));
    fireEvent.change(switchToText(), { target: { value: "SELECT 1" } });
    fireEvent.click(screen.getByRole("tab", { name: "穴埋め" }));
    expect(screen.getByRole("button", { name: "穴 1: HAVING" })).toBeTruthy();
    expect((switchToText() as HTMLTextAreaElement).value).toBe("SELECT 1");
  });
});

describe("CodeDrillList", () => {
  const problems = [
    { id: "SAMPLE-CD-0001", domain: "domain1", language: "sql", title: "SQL の問題", status: "verified" },
    { id: "SAMPLE-CD-0002", domain: "domain2", language: "pyspark", title: "PySpark の問題", status: "verified" },
  ] as const;
  it("分野ごとに並べ_言語で絞り込める", () => {
    render(
      <CodeDrillList
        examCode="TEST"
        examName="テストの資格"
        domains={[
          { code: "domain1", name: "分野 1" },
          { code: "domain2", name: "分野 2" },
        ]}
        problems={[...problems]}
        basePath="/exams/TEST/code-drill"
        preview={false}
      />,
    );
    expect(screen.getByRole("link", { name: /SQL の問題/ }).getAttribute("href")).toBe(
      "/exams/TEST/code-drill/SAMPLE-CD-0001",
    );
    fireEvent.click(screen.getByRole("radio", { name: "PySpark" }));
    expect(screen.queryByRole("link", { name: /SQL の問題/ })).toBeNull();
    expect(screen.getByRole("heading", { name: "分野 2" })).toBeTruthy();
  });
});
