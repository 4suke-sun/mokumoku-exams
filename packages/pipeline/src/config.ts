import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";

export const ConfigSchema = z.strictObject({
  /** 作業用の置き場(取得した本文、段階の成果物)。リポジトリ直下からの相対パス */
  workDir: z.string().min(1),
  /** 出典の台帳の置き場 */
  ledgerDir: z.string().min(1),
  /** 1 回の実行で扱う件数の上限(費用の管理) */
  maxItemsPerRun: z.number().int().positive(),
});

export type Config = z.infer<typeof ConfigSchema>;

/** 項目名だけを持つ。値は持たない */
export class ConfigError extends Error {
  readonly missing: string[];
  readonly invalid: string[];
  constructor(missing: string[], invalid: string[]) {
    super("設定の誤り");
    this.missing = missing;
    this.invalid = invalid;
  }
}

/** 設定ファイル(コミットする、環境値を含まない)を読み、環境値(.env)で上書きできるものを上書きする */
export function loadConfig(configPath: string, env: Record<string, string | undefined>): Config {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(configPath, "utf8"));
  } catch {
    throw new ConfigError(Object.keys(ConfigSchema.shape), []);
  }
  const merged = { ...(typeof raw === "object" && raw !== null ? raw : {}) } as Record<string, unknown>;
  if (env.PIPELINE_WORK_DIR) merged.workDir = env.PIPELINE_WORK_DIR;
  const parsed = ConfigSchema.safeParse(merged);
  if (parsed.success) return parsed.data;
  const missing: string[] = [];
  const invalid: string[] = [];
  for (const issue of parsed.error.issues) {
    if (issue.code === "unrecognized_keys") {
      invalid.push("(未知の項目)");
      continue;
    }
    const name = String(issue.path[0] ?? "(不明)");
    // issue.message や入力値は使わない。項目名だけを集める。値がなければ欠落、あれば不正
    (merged[name] === undefined ? missing : invalid).push(name);
  }
  throw new ConfigError([...new Set(missing)], [...new Set(invalid)]);
}

export function defaultConfigPath(): string {
  return resolve(import.meta.dirname, "../pipeline.config.json");
}
