import { writeFileSync } from "node:fs";
import { type CollectDeps, runCollect } from "./collect/collect.ts";
import { defaultDeps, Fetcher } from "./collect/fetcher.ts";
import { COMMANDS } from "./commands.ts";
import { type Config, ConfigError, loadConfig } from "./config.ts";
import { EXIT, type ExitCode } from "./exit-codes.ts";
import { type Output, report, reportInternalError } from "./log.ts";

export interface Context {
  config: Config;
  dryRun: boolean;
  /** 書き込みは、必ずこれを通す。dry-run では何もしない */
  write(path: string, data: string): void;
}

export interface MainOptions {
  argv: string[];
  env: Record<string, string | undefined>;
  output: Output;
  configPath: string;
  /** リポジトリ直下。設定のパスは、ここからの相対パス */
  rootDir: string;
  /** 収集の依存(テストで差し替える)。省略すると、設定に従う取得器で外部へ通信する */
  collectDeps?: CollectDeps;
}

const KNOWN_FLAGS = ["--help", "-h", "--dry-run", "--import-guide"];

function defaultCollectDeps(config: Config): CollectDeps {
  return {
    fetcher: new Fetcher(config.fetch, defaultDeps),
    today: () => new Date().toISOString().slice(0, 10),
    now: () => Date.now(),
  };
}

function helpText(): string {
  const rows = COMMANDS.map((c) => `  ${c.name.padEnd(8)}${c.summary}`).join("\n");
  return [
    "作問パイプライン",
    "",
    "使い方: npm run pipeline -- <コマンド> [オプション]",
    "",
    "コマンド:",
    rows,
    "",
    "オプション:",
    "  --help, -h  このヘルプ(コマンドの後ろに付けると、そのコマンドのヘルプ)",
    "  --dry-run   書き込みと外部への通信をしない",
    "",
    "collect <資格コード>                 計画に沿って一次情報を集め、台帳に記録する",
    "collect <資格コード> --import-guide  エージェントが抽出した試験ガイドを検査し、台帳に取り込む",
    "",
    "終了コード: 0 成功 / 1 検査の失敗 / 2 入力の誤り / 3 内部の誤り",
    "",
  ].join("\n");
}

export async function main({ argv, env, output, configPath, rootDir, collectDeps }: MainOptions): Promise<ExitCode> {
  try {
    const flags = argv.filter((a) => a.startsWith("-"));
    const positional = argv.filter((a) => !a.startsWith("-"));
    const help = flags.includes("--help") || flags.includes("-h");
    const dryRun = flags.includes("--dry-run");
    if (flags.some((f) => !KNOWN_FLAGS.includes(f))) {
      report(output, "不明なオプション");
      return EXIT.inputError;
    }
    if (positional.length === 0) {
      if (!help && argv.length > 0) {
        report(output, "不明なコマンド");
        return EXIT.inputError;
      }
      output.out(helpText());
      return help || argv.length === 0 ? EXIT.ok : EXIT.inputError;
    }
    const command = COMMANDS.find((c) => c.name === positional[0]);
    const maxArgs = command?.name === "collect" ? 2 : 1;
    if (positional.length > maxArgs || command === undefined) {
      report(output, "不明なコマンド");
      return EXIT.inputError;
    }
    if (flags.includes("--import-guide") && command.name !== "collect") {
      report(output, "不明なオプション");
      return EXIT.inputError;
    }
    if (help) {
      const usage = command.name === "collect" ? "使い方: collect <資格コード> [--import-guide]\n" : "";
      output.out(`${command.name}: ${command.summary}\n${usage}\nオプション: --dry-run, --help\n`);
      return EXIT.ok;
    }
    const config = loadConfig(configPath, env);
    if (command.name === "collect") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return await runCollect({
        config,
        rootDir,
        examCode,
        dryRun,
        importGuide: flags.includes("--import-guide"),
        output,
        deps: collectDeps ?? defaultCollectDeps(config),
      });
    }
    const context: Context = {
      config,
      dryRun,
      write: (path, data) => {
        if (dryRun) report(output, "書き込みをしない(dry-run)");
        else writeFileSync(path, data);
      },
    };
    report(output, "未実装", `${command.name}${context.dryRun ? "(dry-run)" : ""}`);
    return EXIT.ok;
  } catch (error) {
    if (error instanceof ConfigError) {
      for (const name of error.missing) report(output, "設定の欠落", name);
      for (const name of error.invalid) report(output, "設定の不正", name);
      return EXIT.inputError;
    }
    reportInternalError(output, error);
    return EXIT.internalError;
  }
}
