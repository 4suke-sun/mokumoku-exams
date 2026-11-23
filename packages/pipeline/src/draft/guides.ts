import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { styleGuidePaths, vendorOf } from "../scorecard/profiles.ts";
import { termsPath } from "../shared/terms.ts";

/**
 * 下書き・直し・書き直しの依頼に載せる、書き方の指針の文書。ベンダー共通、資格別、ベンダーの用語の辞書(ある場合だけ)の順。
 * 帯のない資格は null。辞書は、作問役と書き直し役が指針として読む(役の定義は変えない)。
 */
export function requestStyleGuides(rootDir: string, examCode: string): string[] | null {
  const guides = styleGuidePaths(examCode);
  if (guides === null) return null;
  const terms = termsPath(vendorOf(examCode));
  return existsSync(resolve(rootDir, terms)) ? [...guides, terms] : guides;
}
