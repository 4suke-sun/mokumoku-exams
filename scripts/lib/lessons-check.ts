/**
 * docs/app/lessons/ の学びの記録の検査。
 * 純粋な関数にして単体テストする(ファイルの読み書きは scripts/check-lessons.ts)。
 * 報告には本文を載せず、場所(ファイル:行)と種類だけを返す。
 */

export interface LessonFile {
  file: string;
  text: string;
}

export interface Lesson {
  file: string;
  number: string;
  title: string;
}

export const REQUIRED_SECTIONS = ["注意すること", "理由", "対処"] as const;

// コードブロックの開始・終了の行(``` と ~~~。インデントされたものも含む)
const FENCE = /^\s*(```|~~~)/;

const FILE_NAME = /^(\d{4})-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

export const INDEX_START = "<!-- lessons:start -->";
export const INDEX_END = "<!-- lessons:end -->";

// 出来事を語る書き方。規則として書く(現在形・一般形)ために、使わない言い方。
const NARRATIVE_PATTERNS = [
  { name: "「〜してしまった」", re: /(し)?てしまった|(し)?てしまい(ました|、)/ },
  { name: "「実際に発生した」の類", re: /実際に(発生|起き|あった|起こ)/ },
  { name: "いつかを指す語", re: /昨日|先日|以前|あのとき|その際|今回(は|の)|今日/ },
  { name: "「〜したところ」", re: /(した|だった)ところ/ },
  { name: "過去の出来事の言い方", re: /ことがあった|ありました|でした[。、]|ました[。、]/ },
];

/** インラインコードを取り除く(コード片の中身は、書き方の検査の対象にしない)。 */
function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, "");
}

/** 1 件の学びの記録を検査する。 */
export function checkLesson({ file, text }: LessonFile): { title: string | null; errors: string[] } {
  const errors: string[] = [];
  if (!FILE_NAME.test(file)) {
    errors.push(`${file}: ファイル名が NNNN-<英小文字と数字とハイフン>.md の形ではありません`);
  }

  const lines = text.split("\n");
  const first = lines[0] ?? "";
  const title = first.startsWith("# ") ? first.slice(2).trim() : "";
  if (title === "") errors.push(`${file}:1: 1 行目が「# 題」の形ではありません`);

  // 見出し(##)の順序と、各節が空でないこと
  const headings: { name: string; line: number }[] = [];
  let inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) inFence = !inFence;
    if (!inFence && line.startsWith("## ")) headings.push({ name: line.slice(3).trim(), line: i + 1 });
  });
  const names = headings.map((h) => h.name);
  if (names.join("\n") !== REQUIRED_SECTIONS.join("\n")) {
    errors.push(`${file}: 見出し(##)が「${REQUIRED_SECTIONS.join("」「")}」の順になっていません`);
  } else {
    headings.forEach((h, k) => {
      const end = headings[k + 1]?.line ?? lines.length + 1;
      const body = lines
        .slice(h.line, end - 1)
        .join("")
        .trim();
      if (body === "") errors.push(`${file}:${h.line}: 「${h.name}」の節が空です`);
    });
  }

  // 出来事を語る書き方
  inFence = false;
  lines.forEach((line, i) => {
    if (FENCE.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) return;
    const plain = stripInlineCode(line);
    for (const { name, re } of NARRATIVE_PATTERNS) {
      if (re.test(plain)) errors.push(`${file}:${i + 1}: 出来事を語る書き方(${name})`);
    }
  });

  return { title: title === "" ? null : title, errors };
}

/** 全件の検査: 各件の検査と、番号の重複。 */
export function checkLessons(files: LessonFile[]): { lessons: Lesson[]; errors: string[] } {
  const errors: string[] = [];
  const lessons: Lesson[] = [];
  const seen = new Map<string, string>();
  for (const f of [...files].sort((a, b) => a.file.localeCompare(b.file))) {
    const result = checkLesson(f);
    errors.push(...result.errors);
    const number = FILE_NAME.exec(f.file)?.[1];
    if (number) {
      const other = seen.get(number);
      if (other) errors.push(`${f.file}: 番号 ${number} が ${other} と重複しています`);
      seen.set(number, f.file);
      if (result.title) lessons.push({ file: f.file, number, title: result.title });
    }
  }
  return { lessons, errors };
}

/** README に載せる一覧(マーカーの内側)を作る。 */
export function renderIndex(lessons: Lesson[]): string {
  if (lessons.length === 0) return "(まだありません)";
  return lessons.map((l) => `- [${l.number} ${l.title}](./${l.file})`).join("\n");
}

/** README のマーカーの内側を、一覧に置き換えた全文を返す。マーカーが無ければ null。 */
export function updateIndex(readme: string, lessons: Lesson[]): string | null {
  const start = readme.indexOf(INDEX_START);
  const end = readme.indexOf(INDEX_END);
  if (start < 0 || end < start) return null;
  return `${readme.slice(0, start + INDEX_START.length)}\n${renderIndex(lessons)}\n${readme.slice(end)}`;
}

/** README の一覧が最新か。最新でなければ、場所と種類のメッセージを返す。 */
export function checkIndex(readme: string, lessons: Lesson[]): string[] {
  const updated = updateIndex(readme, lessons);
  if (updated === null) return [`README.md: 一覧のマーカー(${INDEX_START} と ${INDEX_END})がありません`];
  return updated === readme
    ? []
    : ["README.md: 一覧が最新ではありません(npm run check:lessons -- --write で更新できます)"];
}
