// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Prediction } from "@/lib/dashboard.ts";
import type { PublishedExam } from "@/lib/types.ts";
import { PredictionPanel, predictionMessage } from "./prediction-panel.tsx";

const exam = {
  examCode: "TEST",
  name: "テスト資格",
  shortName: "TEST",
  domains: [
    { code: "domain1", name: "分野 1", weight: 0.6 },
    { code: "domain2", name: "分野 2", weight: 0.4 },
  ],
} as PublishedExam;

const row = (domain: string, over: Partial<Prediction["domains"][number]> = {}): Prediction["domains"][number] => ({
  domain,
  weight: 0.5,
  answered: 4,
  percent: 50,
  substituted: false,
  belowLine: true,
  avgTimeMs: 12_000,
  loss: 25,
  ...over,
});

const prediction = (over: Partial<Prediction> = {}): Prediction => {
  const domains = [row("domain1"), row("domain2", { percent: 90, belowLine: false, loss: 4, avgTimeMs: null })];
  return {
    percent: 66.7,
    passLine: 70,
    reached: false,
    gap: 3.3,
    basedOn: 2,
    domains,
    priorities: [domains[0] as Prediction["domains"][number]],
    ...over,
  };
};

beforeEach(() => {
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: query.includes("reduce"), media: query }));
});

describe("predictionMessage", () => {
  it("届いていない_あと n ポイントで示す", () => {
    expect(predictionMessage(prediction())).toBe("合格ライン(70%)まで、あと 3.3 ポイントです。");
  });

  it("届いている_見込みを伝える", () => {
    expect(predictionMessage(prediction({ reached: true, gap: 0 }))).toBe("合格ライン(70%)に届く見込みです。");
  });
});

describe("PredictionPanel", () => {
  it("優先して復習したい分野_合格ラインより下に文字の印を付け_平均回答時間を添える", () => {
    render(<PredictionPanel exam={exam} prediction={prediction()} />);
    const list = screen.getByRole("list", { name: "優先して復習したい分野" });
    expect(list.textContent).toContain("分野 1");
    expect(list.textContent).toContain("合格ラインより下");
    expect(list.textContent).toContain("50%(4 問、平均 12 秒/問)");
    expect(screen.getByRole("link", { name: "分野 1を解く" }).getAttribute("href")).toContain("domain1");
  });

  it("出題のない分野_全体の正答率で代用したと文字で示す", () => {
    const substituted = row("domain2", { substituted: true, answered: 0, percent: 66.7, avgTimeMs: null });
    render(
      <PredictionPanel exam={exam} prediction={prediction({ priorities: [substituted], domains: [substituted] })} />,
    );
    expect(screen.getByRole("list", { name: "優先して復習したい分野" }).textContent).toContain(
      "出題なし(全体の正答率 66.7% で代用)",
    );
  });

  it("優先する分野がない_一覧を出さない", () => {
    render(<PredictionPanel exam={exam} prediction={prediction({ priorities: [] })} />);
    expect(screen.queryByRole("list", { name: "優先して復習したい分野" })).toBeNull();
  });

  it("分野ごとの内訳_配点と正答率と平均回答時間を表にする", () => {
    render(<PredictionPanel exam={exam} prediction={prediction()} />);
    const table = screen.getByRole("table", { name: "分野ごとの配点・正答率・平均回答時間" });
    const rows = within(table).getAllByRole("row");
    expect(rows[1]?.textContent).toContain("50%");
    expect(rows[1]?.textContent).toContain("12 秒/問");
    expect(rows[2]?.textContent).toContain("-");
  });
});
