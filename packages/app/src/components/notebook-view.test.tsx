// @vitest-environment jsdom
import { act, render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildToc, type NotebookEntry, type NotebookUnit, visibleEntries } from "@/lib/notebook-data.ts";
import { NotebookProgressProvider } from "./notebook-progress.tsx";
import { NotebookCover, NotebookSectionView } from "./notebook-view.tsx";

type Data = { units: Map<string, string>; entries: Map<string, string> };
const client = vi.hoisted(() => ({
  fetchNotebook: vi.fn<(examCode: string) => Promise<Data | null>>(),
  putNotebookEntry: vi.fn<(examCode: string, unit: string, entry: string) => Promise<boolean>>(),
}));
vi.mock("@/lib/history/client.ts", () => client);

const AT = "2026-10-11T15:30:00.000Z";
const done = (entries: string[] = []): Data => ({
  units: new Map(),
  entries: new Map(entries.map((id) => [`domain1-1#${id}`, AT])),
});

beforeEach(() => {
  client.fetchNotebook.mockReset();
  client.fetchNotebook.mockResolvedValue(done());
  client.putNotebookEntry.mockReset();
});

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

/** 節のページを描く。`entryId` が null のときは、見出しのない中分類 */
async function renderSection(unitId: string, entryId: string | null, preview: boolean, withEntries = entries) {
  const unit = units.find((u) => u.id === unitId);
  if (!unit) throw new Error("中分類がありません");
  const visible = visibleEntries(withEntries, preview);
  const entry = entryId === null ? null : (visible.find((e) => e.id === entryId) ?? null);
  const view = render(
    <NotebookProgressProvider examCode="TEST" preview={preview}>
      <NotebookSectionView
        exam={exam}
        units={units}
        unit={unit}
        entry={entry}
        entries={visible}
        basePath="/exams/TEST/notebook"
        preview={preview}
      />
    </NotebookProgressProvider>,
  );
  await act(async () => {});
  return view;
}

describe("NotebookSectionView", () => {
  it("中分類の最初の節_パンくず・完了の行・題・導入・図・見出しの順に出し_比較の表とおさらいは出さない", async () => {
    const { container } = await renderSection("domain1-1", "external-table", false);
    const breadcrumb = screen.getByRole("navigation", { name: "パンくずリスト" });
    expect(breadcrumb.textContent).toContain("1. 分野 1");
    expect(breadcrumb.textContent).toContain("1-1 テーブルの種類");
    expect(within(breadcrumb).getByText("外部テーブル").getAttribute("aria-current")).toBe("page");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("1-1 テーブルの種類");
    expect(screen.getByText("導入の文です。")).toBeTruthy();
    const order = [...container.querySelectorAll("h1, p, figure, h2")].map((el) =>
      el.tagName === "H2" ? `h2:${el.textContent}` : el.tagName.toLowerCase(),
    );
    const at = (item: string) => order.indexOf(item);
    expect(at("figure")).toBeGreaterThan(at("h1"));
    expect(at("h2:外部テーブル")).toBeGreaterThan(at("figure"));
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByRole("heading", { name: "ここまでのおさらい" })).toBeNull();
    expect(screen.queryByText("マネージドテーブル", { selector: "h2" })).toBeNull();
  });

  it("中分類の最後の節_題と導入と中分類の図は出さず_下に比較の表とおさらい_前後の中分類のリンクの順", async () => {
    client.fetchNotebook.mockResolvedValue(done(["external-table", "managed-table"]));
    const { container } = await renderSection("domain1-1", "managed-table", false);
    expect(screen.queryByText("導入の文です。")).toBeNull();
    expect(screen.getByRole("heading", { level: 1, hidden: true }).textContent).toBe("1-1 テーブルの種類");
    expect(screen.getByRole("heading", { level: 1, hidden: true }).getAttribute("class")).toContain("sr-only");
    const order = [...container.querySelectorAll("h2, nav")].map((el) =>
      el.tagName === "H2" ? `h2:${el.textContent}` : `nav:${el.getAttribute("aria-label")}`,
    );
    const at = (item: string) => order.indexOf(item);
    expect(at("h2:マネージドテーブル")).toBeGreaterThanOrEqual(0);
    expect(at("h2:比べる")).toBeGreaterThan(at("h2:マネージドテーブル"));
    expect(at("h2:ここまでのおさらい")).toBeGreaterThan(at("h2:比べる"));
    expect(at("nav:前後の中分類")).toBeGreaterThan(at("h2:ここまでのおさらい"));
    const pager = screen.getByRole("navigation", { name: "前後の中分類" });
    expect(within(pager).getByRole("link").getAttribute("href")).toBe("/exams/TEST/notebook/domain1-2");
    // 最後の節には「次の節へ」がない。前の節へは戻れる
    expect(screen.queryByRole("link", { name: /次の節へ/ })).toBeNull();
    expect(screen.getByRole("link", { name: /前の節/ }).getAttribute("href")).toBe(
      "/exams/TEST/notebook/domain1-1/external-table",
    );
  });

  it("次の節へ_確認に正解していなくても_すでに完了していても_最初から出す", async () => {
    await renderSection("domain1-1", "external-table", false);
    expect(screen.getByRole("link", { name: /次の節へ/ }).getAttribute("href")).toBe(
      "/exams/TEST/notebook/domain1-1/managed-table",
    );
    document.body.innerHTML = "";
    client.fetchNotebook.mockResolvedValue(done(["external-table"]));
    await renderSection("domain1-1", "external-table", false);
    expect(screen.getByRole("link", { name: /次の節へ/ }).getAttribute("href")).toBe(
      "/exams/TEST/notebook/domain1-1/managed-table",
    );
  });

  it("おさらい_中分類の節がすべて完了するまで出さず_完了したら画面に出す見出しの確認の問いだけを集める", async () => {
    await renderSection("domain1-1", "managed-table", false);
    expect(screen.queryByRole("region", { name: "ここまでのおさらい" })).toBeNull();
    document.body.innerHTML = "";
    client.fetchNotebook.mockResolvedValue(done(["external-table", "managed-table"]));
    await renderSection("domain1-1", "managed-table", false);
    const review = screen.getByRole("region", { name: "ここまでのおさらい" });
    expect(within(review).getAllByRole("group")).toHaveLength(2);
    expect(review.textContent).not.toContain("書きかけの用語");
  });

  it("見出しのない中分類_まだ見出しがありませんを出し_おさらいは出さず_前後の中分類へ移れる", async () => {
    await renderSection("domain1-2", null, false);
    expect(screen.getByRole("heading", { name: "まだ見出しがありません" })).toBeTruthy();
    expect(screen.queryByRole("region", { name: "ここまでのおさらい" })).toBeNull();
    const links = within(screen.getByRole("navigation", { name: "前後の中分類" })).getAllByRole("link");
    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "/exams/TEST/notebook/domain1-1",
      "/exams/TEST/notebook/domain2-1",
    ]);
  });

  it("見出し_一言の要点にマーカー_ここを押さえるの囲み_確認は 2 択の問いで回答の前は理由を出さない", async () => {
    const { container } = await renderSection("domain1-1", "external-table", false);
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
  });

  it("関連する見出し_節のページへのリンクにする", async () => {
    await renderSection("domain1-1", "external-table", false);
    expect(screen.getByRole("link", { name: "マネージドテーブル" }).getAttribute("href")).toBe(
      "/exams/TEST/notebook/domain1-1/managed-table",
    );
  });

  it("完了した節_パンくずの下の行に完了を出し_履修済みの中分類は日付つきの履修済みも出す", async () => {
    client.fetchNotebook.mockResolvedValue(done(["external-table", "managed-table"]));
    await renderSection("domain1-1", "external-table", false);
    const labels = [...document.querySelectorAll("article > div:first-child .chip")].map((el) => el.textContent);
    expect(labels).toEqual(["✓ 完了", "✓ 履修済み(2026/10/12)"]);
  });

  it("利用者の画面_未検証の見出しを出さない", async () => {
    await renderSection("domain1-1", "managed-table", false);
    expect(screen.queryByText("書きかけの用語")).toBeNull();
    expect(screen.queryByText(/未検証/)).toBeNull();
  });

  it("管理者のプレビュー_未検証の見出しも出し_未検証と示し_完了を読まない", async () => {
    await renderSection("domain1-1", "draft-term", true);
    expect(screen.getByRole("heading", { name: "書きかけの用語" })).toBeTruthy();
    expect(screen.getByText("! 未検証")).toBeTruthy();
    expect(screen.getByText(/管理者のプレビューです/)).toBeTruthy();
    expect(client.fetchNotebook).not.toHaveBeenCalled();
    // 最後の節なので、完了を読まなくても、比較の表とおさらいが出る
    expect(screen.getByRole("region", { name: "ここまでのおさらい" })).toBeTruthy();
  });

  it("見出しの図_一言の直後_解説の前に描き_図の ID は見出しごとに一意", async () => {
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
    const { container } = await renderSection("domain1-1", "external-table", false, withDiagram);
    const section = container.querySelector("#external-table") as HTMLElement;
    const figure = section.querySelector("figure");
    // 狭い画面で積む形と、左右に並べる形の 2 つを描き、CSS で片方だけを出す
    expect(within(section).getAllByRole("img", { name: "削除から戻せるまで" })).toHaveLength(2);
    const position = (el: Element | null | undefined) => (el ? [...section.querySelectorAll("*")].indexOf(el) : -1);
    expect(position(figure)).toBeGreaterThan(position(section.querySelector("mark")));
    expect(position(figure)).toBeLessThan(position(within(section).getByText("解説")));
    const ids = [...container.querySelectorAll("svg title")].map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("管理者のプレビュー_中分類の最初の節に導入・図・表の検証の状態を示す", async () => {
    await renderSection("domain1-1", "external-table", true);
    expect(screen.getByText(/中分類の導入・図・表/).textContent).toContain("✓ 検証済み");
  });

  it("比較の表_最後の節に列の見出しと値を並べ_要注意の行に文字のラベルを添える", async () => {
    await renderSection("domain1-1", "managed-table", false);
    const table = screen.getByRole("table");
    expect(
      within(table)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toEqual(["観点", "管理", "外部"]);
    expect(within(table).getByRole("rowheader", { name: /DROP/ }).textContent).toContain("要注意");
    expect(table.getAttribute("class")).toContain("table-fixed");
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
