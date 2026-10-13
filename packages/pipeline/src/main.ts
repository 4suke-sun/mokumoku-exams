import { writeFileSync } from "node:fs";
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
    "終了コード: 0 成功 / 1 検査の失敗 / 2 入力の誤り / 3 内部の誤り",
    "",
  ].join("\n");
}

export function main({ argv, env, output, configPath }: MainOptions): ExitCode {
  try {
    const flags = argv.filter((a) => a.startsWith("-"));
    const positional = argv.filter((a) => !a.startsWith("-"));
    const help = flags.includes("--help") || flags.includes("-h");
    const dryRun = flags.includes("--dry-run");
    if (flags.some((f) => !["--help", "-h", "--dry-run"].includes(f))) {
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
    if (positional.length > 1 || command === undefined) {
      report(output, "不明なコマンド");
      return EXIT.inputError;
    }
    if (help) {
      output.out(`${command.name}: ${command.summary}\n\nオプション: --dry-run, --help\n`);
      return EXIT.ok;
    }
    const config = loadConfig(configPath, env);
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
