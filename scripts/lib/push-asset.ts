import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

/** 毎日の通知を送る Lambda の入り口。ここから相対で読み込むファイル(lib/push の中)だけを、JavaScript にして載せる。 */
export const PUSH_ENTRY = "packages/app/src/lib/push/daily.ts";

/** 入り口から読み込むパッケージ。それぞれの依存も、たどって載せる。 */
export const PUSH_PACKAGES = ["web-push", "@aws-sdk/client-dynamodb", "@aws-sdk/lib-dynamodb"];

/**
 * 入り口と、そこから相対で読み込むファイルを、型を除いた JavaScript(ES モジュール)にする。型の検査は `npm run typecheck` で行う。
 * `@/` の別名は Lambda で解決できないため、出力に残っていれば失敗にする。
 */
export function compilePushSources(root: string, outDir: string): void {
  const entry = join(root, PUSH_ENTRY);
  execFileSync(
    join(root, "node_modules", ".bin", "tsc"),
    [
      entry,
      ...["--outDir", outDir, "--rootDir", dirname(entry)],
      ...["--module", "nodenext", "--moduleResolution", "nodenext", "--target", "es2023"],
      ...["--rewriteRelativeImportExtensions", "--noCheck", "--skipLibCheck", "--ignoreConfig"],
    ],
    { stdio: "pipe" },
  );
  for (const name of readdirSync(outDir)) {
    if (name.endsWith(".js") && /from\s+["']@\//.test(readFileSync(join(outDir, name), "utf8"))) {
      throw new Error(`Lambda に載せるファイルが \`@/\` を読み込んでいます: ${name}`);
    }
  }
  writeFileSync(join(outDir, "package.json"), `${JSON.stringify({ type: "module" }, null, 2)}\n`);
}

/** `fromDir` から Node と同じ順(近い node_modules から親へ)でパッケージを探す。 */
function resolvePackage(name: string, fromDir: string, root: string): string | null {
  let dir = fromDir;
  for (;;) {
    const candidate = join(dir, "node_modules", name);
    if (existsSync(join(candidate, "package.json"))) return candidate;
    const parent = dirname(dir);
    if (dir === root || parent === dir) return null;
    dir = parent;
  }
}

/**
 * パッケージと、その依存(`dependencies` と、入っている `optionalDependencies`)を、`outDir/node_modules` に写す。
 * 入れ子の node_modules は、置かれていた形のまま写す。返すのは、写したパッケージの数。
 */
export function copyPackageClosure(options: {
  names: string[];
  fromDir: string;
  root: string;
  outDir: string;
}): number {
  const { names, fromDir, root, outDir } = options;
  const copied = new Map<string, string>();
  const queue = names.map((name) => ({ name, from: fromDir, optional: false }));
  while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const source = resolvePackage(next.name, next.from, root);
    if (!source) {
      if (next.optional) continue;
      throw new Error(`パッケージが見つかりません: ${next.name}(先に npm ci を実行してください)`);
    }
    const segments = relative(root, source).split(sep);
    const target = join(outDir, ...segments.slice(segments.indexOf("node_modules")));
    const already = copied.get(target);
    if (already === source) continue;
    if (already) throw new Error(`同じ場所に、別のパッケージを写そうとしています: ${next.name}`);
    copied.set(target, source);
    cpSync(source, target, {
      recursive: true,
      // 入れ子の node_modules は、依存をたどったときに写す
      filter: (path) => !relative(source, path).split(sep).includes("node_modules"),
    });
    const manifest = JSON.parse(readFileSync(join(source, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      optionalDependencies?: Record<string, string>;
    };
    for (const name of Object.keys(manifest.dependencies ?? {})) queue.push({ name, from: source, optional: false });
    for (const name of Object.keys(manifest.optionalDependencies ?? {}))
      queue.push({ name, from: source, optional: true });
  }
  return copied.size;
}

/** 毎日の通知を送る Lambda のアセットを `outDir/push` に作る(中身は毎回作り直す)。 */
export function buildPushAsset({ root, outDir }: { root: string; outDir: string }): string {
  const pushDir = join(outDir, "push");
  rmSync(pushDir, { recursive: true, force: true });
  compilePushSources(root, pushDir);
  copyPackageClosure({ names: PUSH_PACKAGES, fromDir: join(root, "packages", "app"), root, outDir: pushDir });
  return pushDir;
}
