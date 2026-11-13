// @vitest-environment jsdom
import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { browserStore, type Session, saveSession, setStorageOwner } from "@/lib/storage.ts";
import { ResumeCards } from "./resume-cards.tsx";

const exams = [
  { examCode: "TEST", name: "テスト資格", questionIds: ["TEST-0001", "TEST-0002", "TEST-0003"] },
  { examCode: "TEST2", name: "テスト資格 2", questionIds: ["TEST2-0001", "TEST2-0002"] },
];

function session(examCode: string, questionIds: string[], answers: Session["answers"], startedAt: string): Session {
  return { examCode, questionIds, answers, index: 0, startedAt };
}

beforeEach(() => {
  localStorage.clear();
});

describe("前回の続きのカード", () => {
  it("途中の状態がある_資格名と進み具合と_続きから解くリンクを出す", async () => {
    saveSession(
      browserStore(),
      session("TEST", ["TEST-0001", "TEST-0002", "TEST-0003"], { "TEST-0001": ["A"] }, "2026-10-11T00:00:00.000Z"),
    );
    render(<ResumeCards exams={exams} />);
    const link = await screen.findByRole("link", { name: "テスト資格を続きから解く" });
    expect(link.getAttribute("href")).toBe("/exams/TEST/play");
    expect(screen.getByText("3 問中 1 問に回答しています。")).toBeTruthy();
    expect(screen.queryByText("テスト資格 2")).toBeNull();
  });

  it("進み具合_バーで示し_回答した数と全体の数を文字でも伝える", async () => {
    saveSession(
      browserStore(),
      session("TEST", ["TEST-0001", "TEST-0002", "TEST-0003"], { "TEST-0001": ["A"] }, "2026-10-11T00:00:00.000Z"),
    );
    render(<ResumeCards exams={exams} />);
    const bar = await screen.findByRole("progressbar", { name: "テスト資格の進み具合" });
    expect(bar.getAttribute("aria-valuenow")).toBe("1");
    expect(bar.getAttribute("aria-valuemax")).toBe("3");
    expect(bar.getAttribute("aria-valuetext")).toBe("3 問中 1 問に回答");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("33%");
  });

  it("カードの面_ほかのカードと同じ単色の面で、グラデーションを使わない", async () => {
    saveSession(browserStore(), session("TEST", ["TEST-0001"], {}, "2026-10-11T00:00:00.000Z"));
    render(<ResumeCards exams={exams} />);
    const link = await screen.findByRole("link", { name: "テスト資格を続きから解く" });
    const card = link.closest("li");
    expect(card?.className).toContain("card");
    expect(card?.className).not.toContain("gradient");
  });

  it("強調の色_バーの塗りとボタンの点で使い_カードの面には塗らない", async () => {
    saveSession(browserStore(), session("TEST", ["TEST-0001"], {}, "2026-10-11T00:00:00.000Z"));
    render(<ResumeCards exams={exams} />);
    const link = await screen.findByRole("link", { name: "テスト資格を続きから解く" });
    expect(link.className).toContain("bg-primary");
    expect(link.className).toContain("text-on-primary");
    const bar = screen.getByRole("progressbar", { name: "テスト資格の進み具合" });
    expect((bar.firstElementChild as HTMLElement).className).toContain("bg-primary");
    expect(link.closest("li")?.className).not.toContain("bg-primary");
  });

  it("複数の資格に途中の状態がある_新しく始めた順に並べる", async () => {
    saveSession(browserStore(), session("TEST", ["TEST-0001"], {}, "2026-10-10T00:00:00.000Z"));
    saveSession(browserStore(), session("TEST2", ["TEST2-0001"], {}, "2026-10-11T00:00:00.000Z"));
    render(<ResumeCards exams={exams} />);
    await screen.findAllByRole("link");
    expect(screen.getAllByRole("link").map((a) => a.getAttribute("href"))).toEqual([
      "/exams/TEST2/play",
      "/exams/TEST/play",
    ]);
  });

  it("途中の状態がない_何も出さない", () => {
    const { container } = render(<ResumeCards exams={exams} />);
    expect(container.textContent).toBe("");
  });

  it("いまのデータにない問題を含む_続きから解けないので出さない", () => {
    saveSession(browserStore(), session("TEST", ["TEST-0001", "TEST-0099"], {}, "2026-10-11T00:00:00.000Z"));
    const { container } = render(<ResumeCards exams={exams} />);
    expect(container.textContent).toBe("");
  });

  it("別のアカウントの途中の状態_出さない", () => {
    setStorageOwner("aaaaaaaaaaaaaaaa");
    saveSession(browserStore(), session("TEST", ["TEST-0001"], {}, "2026-10-11T00:00:00.000Z"));
    setStorageOwner("bbbbbbbbbbbbbbbb");
    const { container } = render(<ResumeCards exams={exams} />);
    expect(container.textContent).toBe("");
  });

  it("持ち主の印が取れるまで_読まず_取れたら_そのアカウントの途中の状態を出す", async () => {
    saveSession(browserStore(), session("TEST", ["TEST-0001"], {}, "2026-10-11T00:00:00.000Z"));
    const owner = "0123456789abcdef";
    setStorageOwner(undefined);
    const { container } = render(<ResumeCards exams={exams} />);
    expect(container.textContent).toBe("");
    act(() => setStorageOwner(owner));
    expect(await screen.findByRole("link", { name: "テスト資格を続きから解く" })).toBeTruthy();
  });

  it("持ち主の印が取れない_途中の状態を出さない", () => {
    saveSession(browserStore(), session("TEST", ["TEST-0001"], {}, "2026-10-11T00:00:00.000Z"));
    setStorageOwner(null);
    const { container } = render(<ResumeCards exams={exams} />);
    expect(container.textContent).toBe("");
  });
});
