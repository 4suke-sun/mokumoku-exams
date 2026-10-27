import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { contentHashOf, rawSha256 } from "./content-hash.ts";

/**
 * 取得した本文の作業用キャッシュ。作業用の置き場(gitignore 済み)の中にだけ置き、本文のハッシュ(content-hash.ts)をキーにする。
 * 見える本文が同じ 2 つの HTML は、同じキーになり、あとから書いた本文が残る。旧い定義(生のバイト列の sha256)の名前のファイルも、読める。
 * 書き込みは一時ファイルから置き換えるので、途中で止まっても壊れたファイルを残さない。
 */

const HASH = /^[0-9a-f]{64}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CacheOptions {
  retentionDays: number;
  maxBytes: number;
}

export class BodyCache {
  private readonly dir: string;
  private readonly options: CacheOptions;
  private readonly now: () => number;

  constructor(dir: string, options: CacheOptions, now: () => number = Date.now) {
    this.dir = dir;
    this.options = options;
    this.now = now;
  }

  private path(hash: string): string {
    if (!HASH.test(hash)) throw new Error("ハッシュの形ではない");
    return join(this.dir, `${hash}.body`);
  }

  has(hash: string): boolean {
    return existsSync(this.path(hash));
  }

  /** 読み出す。中身のハッシュが、名前と合わなければ(新旧どちらの定義でも)、壊れたものとして消して null を返す。読んだものは新しい扱いにする */
  read(hash: string): Buffer | null {
    const path = this.path(hash);
    if (!existsSync(path)) return null;
    const body = readFileSync(path);
    if (contentHashOf(body) !== hash && rawSha256(body) !== hash) {
      rmSync(path, { force: true });
      return null;
    }
    const t = new Date(this.now());
    utimesSync(path, t, t);
    return body;
  }

  /** 読み出す。read と違い、何も変えない(壊れたものを消さず、新しい扱いにもしない)。壊れたものは null */
  peek(hash: string): Buffer | null {
    const path = this.path(hash);
    if (!existsSync(path)) return null;
    const body = readFileSync(path);
    return contentHashOf(body) === hash || rawSha256(body) === hash ? body : null;
  }

  /** 書き込み、ハッシュを返す */
  write(body: Buffer): string {
    const hash = contentHashOf(body);
    const path = this.path(hash);
    mkdirSync(this.dir, { recursive: true });
    const tmp = `${path}.${process.pid}.${this.now()}.tmp`;
    try {
      writeFileSync(tmp, body);
      const t = new Date(this.now());
      utimesSync(tmp, t, t);
      renameSync(tmp, path);
    } catch (error) {
      rmSync(tmp, { force: true });
      throw error;
    }
    return hash;
  }

  /** 保持期間を過ぎたもの、書きかけの一時ファイルを消し、容量の上限を超えたら古いものから消す。消した数を返す */
  sweep(): number {
    if (!existsSync(this.dir)) return 0;
    const limit = this.now() - this.options.retentionDays * DAY_MS;
    let removed = 0;
    const kept: { path: string; mtime: number; size: number }[] = [];
    for (const name of readdirSync(this.dir)) {
      const path = join(this.dir, name);
      const stat = statSync(path);
      if (!stat.isFile()) continue;
      if (name.endsWith(".tmp") || !name.endsWith(".body") || stat.mtimeMs < limit) {
        rmSync(path, { force: true });
        removed++;
        continue;
      }
      kept.push({ path, mtime: stat.mtimeMs, size: stat.size });
    }
    kept.sort((a, b) => a.mtime - b.mtime);
    let total = kept.reduce((sum, f) => sum + f.size, 0);
    for (const file of kept) {
      if (total <= this.options.maxBytes) break;
      rmSync(file.path, { force: true });
      total -= file.size;
      removed++;
    }
    return removed;
  }
}
