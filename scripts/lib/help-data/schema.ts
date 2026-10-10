/**
 * 使い方ページのデータ(data/help.json)のスキーマ。形は docs/data-spec.md の「使い方ページのデータ」。
 * 本文は、問題データと同じ限定した記法(docs/data-spec.md の「文字の書き方」)で書く。
 *
 * 検査メッセージに入力の値を含めない(場所と種類だけ)。
 */
import { z } from "zod";

const text = z.string().regex(/\S/, "空白だけの文字列です");

/**
 * リンク先: アプリ内の絶対パス(`/` で始まり、`//` と `..` を含まない)か、https の URL(`@` による認証情報の埋め込みは不可)。
 * それ以外(http、javascript: など)は許可しない。
 */
const HREF = /^(\/(?!\/)(?!.*\.\.)[A-Za-z0-9\-._~/]*|https:\/\/[^\s@]+)$/;

export const HelpLinkSchema = z.strictObject({
  label: text.max(60),
  href: z.string().regex(HREF, "リンク先の形式が違います(アプリ内の絶対パスか https の URL)"),
});

export const HelpSectionSchema = z.strictObject({
  id: z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "ID は英小文字・数字・ハイフンで、英字から始めます"),
  title: text.max(80),
  body: text.max(4000),
  links: z.array(HelpLinkSchema).max(10).optional(),
});

export const HelpFileSchema = z
  .strictObject({ sections: z.array(HelpSectionSchema).min(1).max(30) })
  .superRefine((file, ctx) => {
    const seen = new Set<string>();
    file.sections.forEach((section, i) => {
      if (seen.has(section.id)) {
        ctx.addIssue({ code: "custom", path: ["sections", i, "id"], message: "ID が重複しています" });
      }
      seen.add(section.id);
    });
  });

export type HelpLink = z.infer<typeof HelpLinkSchema>;
export type HelpSection = z.infer<typeof HelpSectionSchema>;
export type HelpFile = z.infer<typeof HelpFileSchema>;
