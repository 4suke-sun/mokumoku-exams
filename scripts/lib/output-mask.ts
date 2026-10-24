/**
 * コマンドの出力(デプロイと、デプロイ前の差分など)から、値を伏せる。伏せるのは次のものだけで、ほかの形は伏せない。
 * - コミット・push・PR の検査と同じ正規表現(認証情報、環境固有の値、個人情報)と、許可されていないメールアドレス
 * - 検査にはなく、ここでだけ伏せる形(数字だけの 12 桁。アカウント ID が前後の文脈なしで出る形)
 * - 渡された値(.env の値と、拒否リストの語。大文字小文字は区別しない)
 * 伏せたあとも、上のどれかに掛かる行は、表示しない(通過した行だけを出す)。
 * 純粋な関数だけを置く(標準入出力、.env と拒否リストの読み込みは scripts/mask-output.ts)。
 */
import {
  disallowedEmails,
  ENV_INFO_PATTERNS,
  PII_CONTENT_PATTERNS,
  SECRET_CONTENT_PATTERNS,
} from "./pr-secrets-check.ts";

export const MASK = "<伏せた値>";
/** .env の値のうち、これより短いものは伏せない(短い値は、ほかの語と区別できない) */
export const MIN_ENV_VALUE = 4;

const PATTERNS: RegExp[] = [
  ...[...SECRET_CONTENT_PATTERNS, ...ENV_INFO_PATTERNS, ...PII_CONTENT_PATTERNS].map((p) => p.re),
  /\b\d{12}\b/,
];
// 端末の色などの制御の並び。値の途中に入ると、どの形にも一致しなくなるので、照合の前に除く
// biome-ignore lint/suspicious/noControlCharactersInRegex: 制御の並びそのものを除くため
const ANSI_ESCAPE = /\u001b\[[0-9;?]*[A-Za-z]/g;

/** .env の変数の値から、伏せる値を選ぶ。空・短い値・プレースホルダー(<...>)は除く */
export function envValues(env: Record<string, string>): string[] {
  return Object.values(env)
    .map((v) => v.trim())
    .filter((v) => v.length >= MIN_ENV_VALUE && !/^<[^>]*>$/.test(v));
}

/** 伏せる値をまとめる。重複を除き、長い順に並べる(部分一致で、短い値が先に伏せないよう) */
export function maskValues(...lists: readonly string[][]): string[] {
  const values = lists.flat().filter((v) => v !== "");
  return [...new Set(values)].sort((a, b) => b.length - a.length);
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** 正規表現か、許可されていないメールアドレスか、伏せる値に、まだ掛かるか */
function leaks(text: string, values: readonly string[]): boolean {
  const lower = text.toLowerCase();
  return (
    PATTERNS.some((re) => re.test(text)) ||
    disallowedEmails(text).length > 0 ||
    values.some((v) => lower.includes(v.toLowerCase()))
  );
}

/** 1 行を伏せる。伏せたあとも検査に掛かれば leaked */
export function maskLine(line: string, values: readonly string[]): { text: string; masked: boolean; leaked: boolean } {
  const plain = line.replace(ANSI_ESCAPE, "");
  let text = plain;
  // 正規表現は、元の行に先に掛ける。値を先に置き換えると、正規表現が要る前後の文脈(ARN の中のリージョンなど)が崩れる
  for (const re of PATTERNS) text = text.replace(new RegExp(re.source, `${re.flags.replace("g", "")}g`), MASK);
  for (const email of disallowedEmails(text)) text = text.split(email).join(MASK);
  for (const value of values) text = text.replace(new RegExp(escapeRegExp(value), "gi"), MASK);
  return { text, masked: text !== plain, leaked: leaks(text, values) };
}
