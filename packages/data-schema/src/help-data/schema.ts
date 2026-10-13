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

const id = z.string().regex(/^[a-z][a-z0-9-]{0,31}$/, "ID は英小文字・数字・ハイフンで、英字から始めます");

/** 実在する日付(YYYY-MM-DD) */
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = z
  .string()
  .regex(DATE, "日付は YYYY-MM-DD で書きます")
  .refine((value) => {
    // 形式の違いは、上の検査だけで報告する
    if (!DATE.test(value)) return true;
    const d = new Date(`${value}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
  }, "実在しない日付です");

/** 節の中の項目(目次の 2 段目)。よくある質問の 1 問なども、これで書く */
export const HelpItemSchema = z.strictObject({
  id,
  title: text.max(80),
  body: text.max(2000),
  links: z.array(HelpLinkSchema).max(10).optional(),
});

export const HelpSectionSchema = z.strictObject({
  id,
  title: text.max(80),
  body: text.max(4000),
  links: z.array(HelpLinkSchema).max(10).optional(),
  items: z.array(HelpItemSchema).max(20).optional(),
});

export const HelpFileSchema = z
  .strictObject({ updatedAt: date.optional(), sections: z.array(HelpSectionSchema).min(1).max(30) })
  .superRefine((file, ctx) => {
    // 節と項目の ID は、どちらも目次のリンク(#id)になるので、ページの中で重複させない
    const seen = new Set<string>();
    const check = (value: string, path: (string | number)[]) => {
      if (seen.has(value)) ctx.addIssue({ code: "custom", path, message: "ID が重複しています" });
      seen.add(value);
    };
    file.sections.forEach((section, i) => {
      check(section.id, ["sections", i, "id"]);
      section.items?.forEach((item, j) => {
        check(item.id, ["sections", i, "items", j, "id"]);
      });
    });
  });

export type HelpLink = z.infer<typeof HelpLinkSchema>;
export type HelpItem = z.infer<typeof HelpItemSchema>;
export type HelpSection = z.infer<typeof HelpSectionSchema>;
export type HelpFile = z.infer<typeof HelpFileSchema>;
