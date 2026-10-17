import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** 一時ファイルに書いてから置き換える。途中で止まっても、壊れたファイルを残さない */
export function writeFileAtomic(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, text);
  renameSync(tmp, path);
}

/** JSON を整形して書く(末尾に改行)。親のディレクトリがなければ作る */
export function writeJson(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`);
}
