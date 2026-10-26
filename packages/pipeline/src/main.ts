import { writeFileSync } from "node:fs";
import { runCandidates } from "./collect/candidates.ts";
import { type CollectDeps, runCollect } from "./collect/collect.ts";
import { defaultDeps, Fetcher } from "./collect/fetcher.ts";
import { runTitles } from "./collect/title.ts";
import { COMMANDS } from "./commands.ts";
import { type Config, ConfigError, loadConfig } from "./config.ts";
import { runDraft } from "./draft/run.ts";
import { runEval } from "./eval/run.ts";
import { EXIT, type ExitCode } from "./exit-codes.ts";
import { runExport } from "./export/export.ts";
import { runFillTitles } from "./export/titles.ts";
import { type FactsMode, runFacts } from "./facts/facts.ts";
import { runJudge } from "./judge/run.ts";
import { runJudgeEval } from "./judge-eval/run.ts";
import { type Output, report, reportInternalError } from "./log.ts";
import { runPlan } from "./plan/run.ts";
import { runReasons } from "./reasons/run.ts";
import { runScore } from "./scorecard/run.ts";
import { runStatus } from "./status/run.ts";
import { runVerify } from "./verify/run.ts";

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

export const KNOWN_FLAGS = [
  "--help",
  "-h",
  "--dry-run",
  "--import-guide",
  "--candidates",
  "--import-candidates",
  "--titles",
  "--import",
  "--coverage",
  "--report",
  "--check",
  "--review",
  "--decide",
  "--revise",
];
/** コマンドごとに、受け付ける動作のオプション(同時には 1 つだけ) */
const MODE_FLAGS: Record<string, readonly string[]> = {
  collect: ["--import-guide", "--candidates", "--import-candidates", "--titles"],
  export: ["--titles"],
  facts: ["--import", "--coverage", "--report"],
  draft: ["--import", "--check", "--review", "--decide", "--revise"],
  verify: ["--import"],
  eval: ["--import"],
  judge: ["--import"],
  "judge-eval": ["--import"],
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
    "collect <資格コード> --candidates   出題範囲の項目ごとに、公式の文書を出典の候補として挙げる依頼を書く",
    "collect <資格コード> --titles       題のない台帳の出典に、公式ページの題を足す(取得するのは題のない出典だけ)",
    "export <資格コード> --titles        題のない問題の出典に、台帳と他の問題の題を足す",
    "collect <資格コード> --import-candidates  エージェントが挙げた候補を検査し、候補の一覧を書く(計画には入れない)",
    "facts <資格コード>                   出典ごとに、事実カードの抽出の依頼を書く",
    "facts <資格コード> --import         エージェントが抽出した事実カードを検査し、取り込む",
    "facts <資格コード> --coverage       分野ごとの件数と、試験ガイドの範囲に対する抜けを報告する",
    "facts <資格コード> --report         本文を含まないレビューレポートを書く",
    "plan <資格コード>                    分野の配点から目標の問題数を出し、既存の問題との差を計画に書く",
    "draft <資格コード>                   計画の項目ごとに、選択式の下書きの依頼を書く",
    "draft <資格コード> --domain=<分野>  依頼を書く分野を 1 つに絞る(ほかの分野は見ない)",
    "draft <資格コード> --import         エージェントが書いた下書きを検査し、取り込む",
    "draft <資格コード> --check          下書きの来歴(根拠の事実カードと出典)を検査する",
    "draft <資格コード> --review         通過・保留の下書きと、人が却下した下書きの表と、判断を書き込むシートを出す",
    "draft <資格コード> --decide         判断を書き込んだシートを、人の判断の記録に取り込む",
    "draft <資格コード> --revise         保留の下書きごとに、ブラッシュアップ役への直しの依頼を書く",
    "verify <資格コード>                 下書きごとに、根拠の節だけを読んで正誤を再導出する検証の依頼を書く",
    "verify <資格コード> --import       検証役の出力を、下書きの宣言と照合して取り込む",
    "eval <資格コード>                   人が承認した下書きから評価用のデータを作り、検証役の評価の依頼を書く",
    "eval <資格コード> --import         検証役の出力を期待する判定と照合し、検出率・誤検出率などのレポートを書く",
    "judge <資格コード>                  公開している選択式の問題ごとに、判定の基準に照らす判定の依頼を書く",
    "judge <資格コード> --import        判定役の出力を依頼と照合して取り込み、判定の結果(公開・書き直しで復帰できる・非公開)を書く",
    "judge-eval <資格コード>             人が承認した下書きから評価用のデータを作り、判定役の評価の依頼を書く",
    "judge-eval <資格コード> --import   判定役の出力を期待する判定と照合し、検出率・誤検出率などのレポートを書く",
    "reasons <資格コード>                不採用と差し戻しの理由を、理由コード・論点・段階ごとに集計し、下書きの指示の改善に使える形で書く。記録は変えない",
    "status <資格コード>                 段階ごとの状態(依頼待ち・取り込み待ち・通過・保留・不採用の件数、役のモデル)を表示する。読むだけ",
    "score <資格コード>                  公開している選択式の問題を、書き方の点数票(問題ごと・束)で採点する。読むだけ。本文は出さない",
    "export <資格コード>                 承認し、検証を通った下書きを、data/ の問題データに書き出す",
    "",
    "終了コード: 0 成功 / 1 検査の失敗 / 2 入力の誤り / 3 内部の誤り",
    "",
  ].join("\n");
}

export async function main({ argv, env, output, configPath, rootDir, collectDeps }: MainOptions): Promise<ExitCode> {
  try {
    // 値を取るオプションは、--domain=<分野のコード> だけ(draft の依頼で、分野を 1 つに絞る)
    const domainArgs = argv.filter((a) => a.startsWith("--domain="));
    const flags = argv.filter((a) => a.startsWith("-") && !a.startsWith("--domain="));
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
    const takesExam =
      command?.name === "collect" ||
      command?.name === "facts" ||
      command?.name === "plan" ||
      command?.name === "draft" ||
      command?.name === "verify" ||
      command?.name === "status" ||
      command?.name === "score" ||
      command?.name === "reasons" ||
      command?.name === "eval" ||
      command?.name === "judge" ||
      command?.name === "judge-eval" ||
      command?.name === "export";
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
    const domainCode = domainArgs[0]?.slice("--domain=".length);
    if (
      domainArgs.length > 1 ||
      (domainArgs.length === 1 && (command.name !== "draft" || modes.length > 0 || !domainCode))
    ) {
      report(output, "不明なオプション");
      return EXIT.inputError;
    }
    if (help) {
      const usages: Record<string, string> = {
        collect: "使い方: collect <資格コード> [--import-guide | --candidates | --import-candidates | --titles]\n",
        facts: "使い方: facts <資格コード> [--import | --coverage | --report]\n",
        plan: "使い方: plan <資格コード>\n",
        export: "使い方: export <資格コード> [--titles]\n",
        verify: "使い方: verify <資格コード> [--import]\n",
        status: "使い方: status <資格コード>\n",
        score: "使い方: score <資格コード>\n",
        reasons: "使い方: reasons <資格コード>\n",
        eval: "使い方: eval <資格コード> [--import]\n",
        judge: "使い方: judge <資格コード> [--import]\n",
        "judge-eval": "使い方: judge-eval <資格コード> [--import]\n",
        draft:
          "使い方: draft <資格コード> [--domain=<分野のコード> | --import | --check | --review | --decide | --revise]\n",
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
      if (flags.includes("--candidates") || flags.includes("--import-candidates")) {
        return runCandidates({
          config,
          rootDir,
          examCode,
          mode: flags.includes("--import-candidates") ? "import" : "request",
          dryRun,
          output,
        });
      }
      if (flags.includes("--titles")) {
        return await runTitles({
          config,
          rootDir,
          examCode,
          dryRun,
          output,
          deps: collectDeps ?? defaultCollectDeps(config),
        });
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
    if (command.name === "plan") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return runPlan({ config, rootDir, examCode, dryRun, output });
    }
    if (command.name === "export") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return flags.includes("--titles")
        ? runFillTitles({ config, rootDir, examCode, dryRun, output })
        : runExport({ config, rootDir, examCode, dryRun, output });
    }
    if (command.name === "eval") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return runEval({
        config,
        rootDir,
        examCode,
        mode: flags.includes("--import") ? "import" : "request",
        dryRun,
        output,
        today: () => new Date().toISOString().slice(0, 10),
      });
    }
    if (command.name === "judge" || command.name === "judge-eval") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      const mode = flags.includes("--import") ? "import" : "request";
      return command.name === "judge"
        ? runJudge({ config, rootDir, examCode, mode, dryRun, output })
        : runJudgeEval({
            config,
            rootDir,
            examCode,
            mode,
            dryRun,
            output,
            today: () => new Date().toISOString().slice(0, 10),
          });
    }
    if (command.name === "reasons") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return runReasons({ config, rootDir, examCode, dryRun, output });
    }
    if (command.name === "status") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return runStatus({ config, rootDir, examCode, output });
    }
    if (command.name === "score") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return runScore({ config, rootDir, examCode, output });
    }
    if (command.name === "verify") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return runVerify({
        config,
        rootDir,
        examCode,
        mode: flags.includes("--import") ? "import" : "request",
        dryRun,
        output,
      });
    }
    if (command.name === "draft") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      const mode = flags.includes("--import")
        ? "import"
        : flags.includes("--check")
          ? "check"
          : flags.includes("--review")
            ? "review"
            : flags.includes("--decide")
              ? "decide"
              : flags.includes("--revise")
                ? "revise"
                : "request";
      return runDraft({
        config,
        rootDir,
        examCode,
        mode,
        dryRun,
        output,
        ...(domainCode !== undefined ? { domain: domainCode } : {}),
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
    // 実装していないコマンドは、成功と取り違えないよう、入力の誤り(使えないコマンド)として 0 以外で終える
    report(output, "未実装", `${command.name}${context.dryRun ? "(dry-run)" : ""}`);
    return EXIT.inputError;
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
