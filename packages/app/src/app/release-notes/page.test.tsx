// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { releaseUrl } from "@/lib/site.ts";
import ReleaseNotesPage from "./page.tsx";

vi.mock("@/lib/release-notes.ts", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/release-notes.ts")>();
  return {
    ...actual,
    listReleases: () => [
      {
        version: "v0.0.3",
        date: "2026-10-09",
        title: "題 3",
        items: [
          { type: "feat", text: "機能の説明" },
          { type: "dev", text: "開発の説明" },
          { type: "fix", text: "修正の説明" },
        ],
      },
      { version: "v0.0.2", date: "2026-10-08", title: "題 2", items: [{ type: "dev", text: "開発だけの説明" }] },
    ],
  };
});

afterEach(() => {
  cleanup();
});

function section(version: string): HTMLElement {
  const heading = screen.getByRole("heading", { level: 2, name: new RegExp(version.replace(/\./g, "\\.")) });
  const el = heading.closest("section");
  if (!el) throw new Error("section がありません");
  return el;
}

describe("ReleaseNotesPage", () => {
  it("開発の項目が混ざった版_利用者向けの項目だけを種類のラベルつきで出す", () => {
    render(<ReleaseNotesPage />);
    const items = within(section("v0.0.3"))
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    expect(items).toEqual(["機能機能の説明", "修正修正の説明"]);
    expect(screen.queryByText("開発の説明")).toBeNull();
  });

  it("開発の項目だけの版_版とタイトルを出し_項目の代わりに開発者向けである旨とその版の Release へのリンクを出す", () => {
    render(<ReleaseNotesPage />);
    const el = section("v0.0.2");
    expect(within(el).getByText("題 2")).toBeTruthy();
    expect(within(el).queryByRole("list")).toBeNull();
    expect(el.querySelector("p.text-muted")?.textContent).toBe(
      "開発者向けのアップデートです。詳細はこちら(外部サイト)をご確認ください。",
    );
    const link = within(el).getByRole("link", { name: "こちら(外部サイト)" });
    expect(link.getAttribute("href")).toBe(releaseUrl("v0.0.2"));
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.queryByText("開発だけの説明")).toBeNull();
  });

  it("利用者向けの項目のある版_Release へのリンクを出さない", () => {
    render(<ReleaseNotesPage />);
    expect(within(section("v0.0.3")).queryByRole("link")).toBeNull();
  });
});
