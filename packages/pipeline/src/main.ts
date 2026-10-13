import { writeFileSync } from "node:fs";
import { type CollectDeps, runCollect } from "./collect/collect.ts";
import { defaultDeps, Fetcher } from "./collect/fetcher.ts";
import { COMMANDS } from "./commands.ts";
import { type Config, ConfigError, loadConfig } from "./config.ts";
import { EXIT, type ExitCode } from "./exit-codes.ts";
import { type FactsMode, runFacts } from "./facts/facts.ts";
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

const KNOWN_FLAGS = ["--help", "-h", "--dry-run", "--import-guide", "--import", "--coverage", "--report"];
/** コマンドごとに、受け付ける動作のオプション(同時には 1 つだけ) */
const MODE_FLAGS: Record<string, readonly string[]> = {
  collect: ["--import-guide"],
  facts: ["--import", "--coverage", "--report"],
};

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
    "facts <資格コード>                   出典ごとに、事実カードの抽出の依頼を書く",
    "facts <資格コード> --import         エージェントが抽出した事実カードを検査し、取り込む",
    "facts <資格コード> --coverage       分野ごとの件数と、試験ガイドの範囲に対する抜けを報告する",
    "facts <資格コード> --report         本文を含まないレビューレポートを書く",
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
    const takesExam = command?.name === "collect" || command?.name === "facts";
    const maxArgs = takesExam ? 2 : 1;
    if (positional.length > maxArgs || command === undefined) {
      report(output, "不明なコマンド");
      return EXIT.inputError;
    }
    const allowed = MODE_FLAGS[command.name] ?? [];
    const modes = flags.filter((f) => Object.values(MODE_FLAGS).some((list) => list.includes(f)));
    if (modes.some((f) => !allowed.includes(f)) || modes.length > 1) {
      report(output, "不明なオプション");
      return EXIT.inputError;
    }
    if (help) {
      const usages: Record<string, string> = {
        collect: "使い方: collect <資格コード> [--import-guide]\n",
        facts: "使い方: facts <資格コード> [--import | --coverage | --report]\n",
      };
      const usage = usages[command.name] ?? "";
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
    if (command.name === "facts") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      const deps = collectDeps ?? defaultCollectDeps(config);
      const mode: FactsMode = flags.includes("--import")
        ? "import"
        : flags.includes("--coverage")
          ? "coverage"
          : flags.includes("--report")
            ? "report"
            : "request";
      return await runFacts({
        config,
        rootDir,
        examCode,
        mode,
        dryRun,
        output,
        deps: { today: deps.today, now: deps.now },
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
