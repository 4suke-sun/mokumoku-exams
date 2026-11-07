// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { buildToc, type NotebookEntry, type NotebookUnit, visibleEntries } from "@/lib/notebook-data.ts";
import { NotebookCover, NotebookUnitView } from "./notebook-view.tsx";

const exam = {
  examCode: "TEST",
  name: "テストの資格",
  domains: [
    { code: "domain1", name: "分野 1", weight: 0.4 },
    { code: "domain2", name: "分野 2", weight: 0.6 },
  ],
};
const units: NotebookUnit[] = [
  {
    id: "domain1-1",
    domain: "domain1",
    order: 1,
    title: "テーブルの種類",
    intro: "導入の文です。",
    diagram: {
      type: "compare",
      title: "DROP したとき",
      left: { heading: "管理", items: [{ label: "ファイル", state: "removed" }] },
      right: { heading: "外部", items: [{ label: "ファイル", state: "kept" }] },
    },
    comparison: {
      columns: ["管理", "外部"],
      rows: [
        { aspect: "置き場所", cells: ["管理の場所", "`LOCATION` の場所"] },
        { aspect: "DROP", cells: ["消える", "残る"], highlight: true },
      ],
    },
    status: "verified",
  },
  { id: "domain1-2", domain: "domain1", order: 2, title: "空の中分類", status: "verified" },
  { id: "domain2-1", domain: "domain2", order: 1, title: "別の分野", status: "verified" },
];
const entry = (over: Partial<NotebookEntry>): NotebookEntry => ({
  id: "external-table",
  unit: "domain1-1",
  order: 1,
  term: "外部テーブル",
  oneLine: "外部の場所にデータを置くテーブル。DROP してもファイルは残る。",
  keyPhrase: "DROP してもファイルは残る",
  diagram: {
    type: "flow",
    title: "図",
    nodes: [
      { id: "a", label: "入力" },
      { id: "b", label: "出力" },
    ],
    edges: [{ from: "a", to: "b" }],
  },
  body: "解説です。\n\n```\nDROP TABLE sales;\n```",
  examAngle: "ファイルが残る理由を、テーブルの種類と結びつけて覚える。",
  checks: [
    {
      question: "DROP したとき、外部テーブルで残るのはどっち?",
      choices: [
        { key: "A", text: "データファイル", reason: "持ち主がストレージだから。" },
        { key: "B", text: "メタデータ", reason: "メタデータは消えるから。" },
      ],
      correct: "A",
    },
  ],
  related: ["managed-table"],
  references: [{ title: "公式の文書", url: "https://docs.databricks.com/" }],
  status: "verified",
  ...over,
});
const entries = [
  entry({}),
  entry({ id: "managed-table", order: 2, term: "マネージドテーブル", keyPhrase: undefined, related: undefined }),
  entry({ id: "draft-term", order: 3, term: "書きかけの用語", status: "unverified", related: undefined }),
];

function renderUnit(unitId: string, preview: boolean) {
  const unit = units.find((u) => u.id === unitId);
  if (!unit) throw new Error("中分類がありません");
  return render(
    <NotebookUnitView
      exam={exam}
      units={units}
      unit={unit}
      entries={visibleEntries(entries, preview)}
      basePath="/exams/TEST/notebook"
      preview={preview}
    />,
  );
}

describe("NotebookUnitView", () => {
  it("中分類のページ_パンくず・題・導入・図・見出し・比較の表・前後のリンクの順に出す", () => {
    const { container } = renderUnit("domain1-1", false);
    const breadcrumb = screen.getByRole("navigation", { name: "パンくずリスト" });
    expect(breadcrumb.textContent).toContain("1. 分野 1");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("1-1 テーブルの種類");
    const order = [...container.querySelectorAll("h1, p, figure, h2, table")].map((el) =>
      el.tagName === "H2" ? `h2:${el.textContent}` : el.tagName.toLowerCase(),
    );
    const at = (item: string) => order.indexOf(item);
    expect(at("figure")).toBeGreaterThan(at("h1"));
    expect(at("h2:外部テーブル")).toBeGreaterThan(at("figure"));
    expect(at("h2:比べる")).toBeGreaterThan(at("h2:マネージドテーブル"));
    expect(at("h2:ここまでのおさらい")).toBeGreaterThan(at("h2:比べる"));
    const pager = screen.getByRole("navigation", { name: "前後の中分類" });
    expect(within(pager).getByRole("link").getAttribute("href")).toBe("/exams/TEST/notebook/domain1-2");
  });

  it("おさらい_画面に出す見出しの確認の問いだけを集め_見出しのない中分類には出さない", () => {
    renderUnit("domain1-1", false);
    const review = screen.getByRole("region", { name: "ここまでのおさらい" });
    expect(within(review).getAllByRole("group")).toHaveLength(2);
    expect(review.textContent).not.toContain("書きかけの用語");
  });

  it("おさらい_見出しのない中分類_出さない", () => {
    renderUnit("domain1-2", false);
    expect(screen.queryByRole("region", { name: "ここまでのおさらい" })).toBeNull();
  });

  it("見出し_一言の要点にマーカー_ここを押さえるの囲み_確認は 2 択の問いで回答の前は理由を出さない", () => {
    const { container } = renderUnit("domain1-1", false);
    const section = container.querySelector("#external-table");
    expect(section?.querySelector("mark")?.textContent).toBe("DROP してもファイルは残る");
    expect(section?.querySelector("mark")?.getAttribute("class")).toContain("motion-marker");
    expect(section?.textContent).toContain("ここを押さえる");
    const check = within(section as HTMLElement).getByRole("group", {
      name: "DROP したとき、外部テーブルで残るのはどっち?",
    });
    expect(within(check).getAllByRole("radio")).toHaveLength(2);
    expect(within(check).getByRole("button", { name: "回答する" }).hasAttribute("disabled")).toBe(true);
    expect(check.textContent).not.toContain("持ち主がストレージだから。");
    expect(section?.textContent).toContain("✓ 検証済み");
    expect(
      within(section as HTMLElement)
        .getByRole("link", { name: "マネージドテーブル" })
        .getAttribute("href"),
    ).toBe("#managed-table");
  });

  it("利用者の画面_未検証の見出しを出さない", () => {
    renderUnit("domain1-1", false);
    expect(screen.queryByText("書きかけの用語")).toBeNull();
    expect(screen.queryByText(/未検証/)).toBeNull();
  });

  it("管理者のプレビュー_未検証の見出しも出し_未検証と示す", () => {
    renderUnit("domain1-1", true);
    expect(screen.getByRole("heading", { name: "書きかけの用語" })).toBeTruthy();
    expect(screen.getByText("! 未検証")).toBeTruthy();
    expect(screen.getByText(/管理者のプレビューです/)).toBeTruthy();
  });

  it("見出しの図_一言の直後_解説の前に描き_図の ID は見出しごとに一意", () => {
    const withDiagram = [
      entry({
        diagram: {
          type: "timeline",
          title: "削除から戻せるまで",
          events: [
            { id: "drop", label: "DROP" },
            { id: "limit", label: "期限" },
          ],
        },
      }),
      entry({ id: "managed-table", order: 2, term: "マネージドテーブル", related: undefined }),
    ];
    const unit = units[0];
    if (!unit) throw new Error("中分類がありません");
    const { container } = render(
      <NotebookUnitView
        exam={exam}
        units={units}
        unit={unit}
        entries={withDiagram}
        basePath="/exams/TEST/notebook"
        preview={false}
      />,
    );
    const section = container.querySelector("#external-table") as HTMLElement;
    const figure = section.querySelector("figure");
    // 狭い画面で積む形と、左右に並べる形の 2 つを描き、CSS で片方だけを出す
    expect(within(section).getAllByRole("img", { name: "削除から戻せるまで" })).toHaveLength(2);
    const position = (el: Element | null | undefined) => (el ? [...section.querySelectorAll("*")].indexOf(el) : -1);
    expect(position(figure)).toBeGreaterThan(position(section.querySelector("mark")));
    expect(position(figure)).toBeLessThan(position(within(section).getByText("解説")));
    // 図は必須: どの見出しにも 1 つある
    expect(container.querySelectorAll("#managed-table figure")).toHaveLength(1);
    const ids = [...container.querySelectorAll("svg title")].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("管理者のプレビュー_中分類の導入・図・表の検証の状態を示す", () => {
    renderUnit("domain1-1", true);
    expect(screen.getByText(/中分類の導入・図・表/).textContent).toContain("✓ 検証済み");
  });

  it("比較の表_列の見出しと値を並べ_要注意の行に文字のラベルを添える", () => {
    renderUnit("domain1-1", false);
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["観点", "管理", "外部"]);
    expect(within(table).getByRole("rowheader", { name: /DROP/ }).textContent).toContain("要注意");
    expect(table.getAttribute("class")).toContain("table-fixed");
  });

  it("空の中分類_まだ見出しがありませんを出し_前後の中分類へ移れる", () => {
    renderUnit("domain1-2", false);
    expect(screen.getByRole("heading", { name: "まだ見出しがありません" })).toBeTruthy();
    const links = within(screen.getByRole("navigation", { name: "前後の中分類" })).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/exams/TEST/notebook/domain1-1",
      "/exams/TEST/notebook/domain2-1",
    ]);
  });
});

describe("NotebookCover", () => {
  it("分野のタイル_番号・名前・配点・見出しの数・記載のある中分類の割合を出す", () => {
    const toc = buildToc(exam.domains, units, visibleEntries(entries, false));
    render(<NotebookCover exam={exam} toc={toc} basePath="/exams/TEST/notebook" preview={false} />);
    const tile = screen.getByRole("link", { name: /1\. 分野 1/ });
    expect(tile.textContent).toContain("配点 40%");
    expect(tile.textContent).toContain("見出し 2 件");
    expect(tile.textContent).toContain("中分類 1 / 2 に記載");
    expect(tile.getAttribute("href")).toBe("/exams/TEST/notebook/domain1-1");
    expect(screen.getByRole("link", { name: "モード選択へ戻る" }).getAttribute("href")).toBe("/exams/TEST");
  });
});
