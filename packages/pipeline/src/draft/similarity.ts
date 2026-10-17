import { dice } from "../shared/similarity.ts";

/** 2 つの文の類似度(0〜1)。文字のバイグラムの Dice 係数(`shared/similarity.ts`) */
export const similarity = dice;

/**
 * 設問文の末尾の決まり文句(「最も適切なものはどれですか。」「2 つ選択してください。」など)。
 * 多くの設問に共通するので、残すと、別の論点の設問どうしの類似度が上がる。
 */
const STEM_TAIL =
  /[、。]?\s*(?:(?:最も)?(?:適切|正しい|推奨される|有効|妥当)な?(?:もの|方法|対応|運用|説明|示し方|役割|目標|記述)?(?:として)?(?:は|を)?\s*)?どれ(?:ですか|か)[。?？]?\s*(?:[0-9０-９一二三四五]+\s*つ(?:選択して|選んで)ください。?)?\s*$/u;

/** 設問文から末尾の決まり文句を外した部分。外すと何も残らないときは、元の文 */
export function stemCore(stem: string): string {
  const core = stem.replace(STEM_TAIL, "");
  return core.trim() === "" ? stem : core;
}

/** 設問文どうしの類似度。末尾の決まり文句を外してから比べる */
export function stemSimilarity(a: string, b: string): number {
  return similarity(stemCore(a), stemCore(b));
}
