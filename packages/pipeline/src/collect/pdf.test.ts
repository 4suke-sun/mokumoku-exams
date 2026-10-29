import { describe, expect, it } from "vitest";
import { isPdf, pdfToText } from "./pdf.ts";
import { syntheticPdf } from "./test-helpers.ts";

describe("PDF の本文", () => {
  it("先頭が PDF の印_PDF と判定し、HTML は PDF と判定しない", () => {
    expect(isPdf(syntheticPdf("Synthetic guide"))).toBe(true);
    expect(isPdf(Buffer.from("<html><body>Synthetic</body></html>"))).toBe(false);
  });

  it("PDF の本文_ページの文字をテキストにする", async () => {
    expect(await pdfToText(syntheticPdf("Section 1: Synthetic topics"))).toContain("Section 1: Synthetic topics");
  });
});
