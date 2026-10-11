// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { Notice } from "./notice.tsx";

describe("Notice", () => {
  it("エラー_すぐに読み上げ_種類の名前を文字で添える", () => {
    render(<Notice kind="error">保存できませんでした。</Notice>);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("保存できませんでした。");
    expect(alert.textContent).toContain("エラー");
    expect(alert.getAttribute("data-kind")).toBe("error");
  });

  it("成功とお知らせ_控えめに読み上げる", () => {
    const { unmount } = render(<Notice kind="success">保存しました。</Notice>);
    expect(screen.getByRole("status").textContent).toContain("完了");
    expect(screen.queryByRole("alert")).toBeNull();
    unmount();
    render(<Notice kind="info">メンテナンスの予定があります。</Notice>);
    expect(screen.getByRole("status").textContent).toContain("お知らせ");
  });

  it("記号は飾りとして読み上げない", () => {
    const { container } = render(<Notice kind="success">保存しました。</Notice>);
    const mark = container.querySelector('[aria-hidden="true"]');
    expect(mark?.textContent).toBe("✓");
  });
});
