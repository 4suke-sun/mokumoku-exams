// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { isLinkableReference, ReferenceList, referenceLabel } from "./reference-list.tsx";

describe("ReferenceList", () => {
  it("出典を_新しいタブで開くリンクとして表示する", () => {
    render(<ReferenceList references={[{ title: "公式の資料", url: "https://docs.aws.amazon.com/guide" }]} />);
    expect(screen.getByRole("heading", { name: "出典" })).toBeTruthy();
    const link = screen.getByRole("link", { name: "公式の資料(外部サイト)" });
    expect(link.getAttribute("href")).toBe("https://docs.aws.amazon.com/guide");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });

  it("題のある出典_ホスト名ではなく題を表示する", () => {
    render(
      <ReferenceList
        references={[{ title: "Amazon SQS のデッドレターキュー", url: "https://docs.aws.amazon.com/queue.html" }]}
      />,
    );
    expect(screen.getByRole("link", { name: "Amazon SQS のデッドレターキュー(外部サイト)" })).toBeTruthy();
    expect(screen.queryByText(/docs\.aws\.amazon\.com/)).toBeNull();
  });

  it("題のない出典_ホスト名を表示する", () => {
    render(<ReferenceList references={[{ url: "https://www.nist.gov/itl/ai" }]} />);
    expect(screen.getByRole("link", { name: "www.nist.gov(外部サイト)" })).toBeTruthy();
    expect(referenceLabel({ url: "not a url" })).toBe("not a url");
  });

  it("https でない・URL として読めない出典_リンクにせず文字だけで出す", () => {
    render(
      <ReferenceList
        references={[
          { title: "スクリプト", url: "javascript:alert(1)" },
          { title: "平文", url: "http://docs.aws.amazon.com/" },
          { url: "not a url" },
          { title: "公式", url: "https://docs.aws.amazon.com/" },
        ]}
      />,
    );
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "https://docs.aws.amazon.com/",
    ]);
    expect(screen.getByText("スクリプト")).toBeTruthy();
    expect(screen.getByText("平文")).toBeTruthy();
    expect(screen.getByText("not a url")).toBeTruthy();
    expect(isLinkableReference({ url: "javascript:alert(1)" })).toBe(false);
    expect(isLinkableReference({ url: "https://aws.amazon.com/" })).toBe(true);
  });

  it("出典がない・空_何も表示しない", () => {
    const { container, rerender } = render(<ReferenceList />);
    expect(container.innerHTML).toBe("");
    rerender(<ReferenceList references={[]} />);
    expect(container.innerHTML).toBe("");
  });
});
