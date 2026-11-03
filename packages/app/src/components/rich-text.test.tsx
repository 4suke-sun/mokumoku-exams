// @vitest-environment jsdom
import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { InlineText, RichText } from "./rich-text.tsx";

describe("本文の記法のインラインコード", () => {
  it("1 行の本文のインラインコード_どこでも折り返せる指定が付く", () => {
    const { container } = render(
      <InlineText text="`spark.databricks.delta.retentionDurationCheck.enabled` を変えます" />,
    );
    const code = container.querySelector("code");
    expect(code?.textContent).toBe("spark.databricks.delta.retentionDurationCheck.enabled");
    expect(code?.className).toContain("wrap-anywhere");
  });

  it("段落の本文のインラインコード_どこでも折り返せる指定が付く", () => {
    const { container } = render(<RichText text={"段落です。\n\n`a.very.long.setting.name` を使います。"} />);
    const code = container.querySelector("p code");
    expect(code?.className).toContain("wrap-anywhere");
  });

  it("箇条書きの本文のインラインコード_どこでも折り返せる指定が付く", () => {
    const { container } = render(<RichText text={"- `a.very.long.setting.name` を使います"} />);
    const code = container.querySelector("li code");
    expect(code?.className).toContain("wrap-anywhere");
  });

  it("見出しの本文のインラインコード_どこでも折り返せる指定が付く", () => {
    const { container } = render(<RichText text={"## `a.very.long.setting.name` の扱い"} />);
    const code = container.querySelector("p.font-bold code");
    expect(code?.className).toContain("wrap-anywhere");
  });

  it("コードのブロック_折り返さず、欄の中で横にスクロールする", () => {
    const { container } = render(<RichText text={"```\nspark.conf.set('a.very.long.setting.name', 'false')\n```"} />);
    const pre = container.querySelector("pre");
    expect(pre?.className).toContain("overflow-x-auto");
    expect(pre?.querySelector("code")?.className ?? "").not.toContain("wrap-anywhere");
  });
});
