import type { MetadataRoute } from "next";
import { robotsOf, siteUrl } from "@/lib/site.ts";

// 公開の URL(SITE_URL)を、ビルドのときではなく、実行の環境から読む
export const dynamic = "force-dynamic";

export default function robots(): MetadataRoute.Robots {
  return robotsOf(siteUrl());
}
