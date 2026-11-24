import { writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { runCandidates } from "./collect/candidates.ts";
import { type CollectDeps, runCollect } from "./collect/collect.ts";
import { defaultDeps, Fetcher } from "./collect/fetcher.ts";
import { runTitles } from "./collect/title.ts";
import { COMMANDS } from "./commands.ts";
import { type Config, ConfigError, loadConfig } from "./config.ts";
import { EXAM_CODE } from "./contract.ts";
import { runDraft } from "./draft/run.ts";
import { runEval } from "./eval/run.ts";
import { EXIT, type ExitCode } from "./exit-codes.ts";
import { runExport } from "./export/export.ts";
import { runFillTitles } from "./export/titles.ts";
import { type FactsMode, runFacts } from "./facts/facts.ts";
import { runEvalGate } from "./gate/run.ts";
import { runJudge } from "./judge/run.ts";
import { runJudgeEval } from "./judge-eval/run.ts";
import { type Output, report, reportInternalError } from "./log.ts";
import { runPlan } from "./plan/run.ts";
import { runReasons } from "./reasons/run.ts";
import { runRehash } from "./rehash/run.ts";
import { runRestore } from "./restore/run.ts";
import { runScore } from "./scorecard/run.ts";
import { readAgentStampOrReport } from "./shared/agents.ts";
import { readAttemptsFile } from "./shared/bundles.ts";
import { runStatus } from "./status/run.ts";
import { runEvalSweep } from "./tuning/run.ts";
import { runUnpublish } from "./unpublish/run.ts";
import { bundleRequests } from "./verify/bundles.ts";
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
  "--rewrite",
  "--refetch",
  "--record",
  "--bundles",
];
const VALUE_OPTION = /^--(domain|targets|reason|role)=/;
/** 値を取るオプションを、受け付けるコマンド */
const VALUE_OPTION_COMMANDS: Record<string, readonly string[]> = {
  "--domain=": ["draft"],
  "--targets=": ["eval-sweep"],
  "--reason=": ["eval-sweep"],
  "--role=": ["eval-gate"],
};
/** コマンドごとに、受け付ける動作のオプション(同時には 1 つだけ) */
const MODE_FLAGS: Record<string, readonly string[]> = {
  collect: ["--import-guide", "--candidates", "--import-candidates", "--titles"],
  export: ["--titles"],
  facts: ["--import", "--coverage", "--report"],
  draft: ["--import", "--check", "--review", "--decide", "--revise", "--rewrite"],
  verify: ["--import", "--bundles"],
  eval: ["--import", "--bundles"],
  judge: ["--import"],
  "judge-eval": ["--import"],
  rehash: ["--refetch"],
  "eval-sweep": ["--record"],
  "eval-gate": ["--record"],
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
    "draft <資格コード> --review         要判断の下書き(通過・保留と、人が却下したもの)の表と、判断を書き込むシートを出す",
    "draft <資格コード> --decide         判断を書き込んだシートを、人の判断の記録に取り込む",
    "draft <資格コード> --revise         保留の下書きごとに、ブラッシュアップ役への直しの依頼を書く",
    "draft <資格コード> --rewrite        非公開の問題(判定が書き直しで復帰できる)ごとに、ブラッシュアップ役への書き直しの依頼を書く(取り込みは --import)",
    "verify <資格コード>                 下書きごとに、根拠の節だけを読んで正誤を再導出する検証の依頼を書く",
    "verify <資格コード> --import       検証役の出力を、下書きの宣言と照合して取り込む",
    "verify <資格コード> --bundles      待っている検証の依頼を、検証役の 1 回の起動に渡す束(同じ check、設定の verify.bundleSize 件ずつ)に分けて表示する。読むだけ",
    "eval <資格コード>                   人が承認した下書きから評価用のデータを作り、検証役の評価の依頼を書く",
    "eval <資格コード> --import         検証役の出力を期待する判定と照合し、検出率・誤検出率などのレポートを書く",
    "eval <資格コード> --bundles        待っている評価の依頼を、検証と同じ束に分けて表示する。読むだけ",
    "eval-sweep <資格コード> --targets=…  検証役の評価の結果に、目標の候補(<全体>/<種類ごと>/<誤検出の上限>)を当てて比べる。モデルは呼ばない",
    "eval-sweep <資格コード> --record --reason=<理由> --targets=…  設定の目標を、比べた表と理由つきで、しきい値の台帳に足す",
    "eval-gate                          評価の対象(役の定義・設定)が、最後に合格した記録と同じかを検査する。ネットワークもモデルも使わない",
    "eval-gate --record --role=<verifier|judge>  現在の定義で評価して目標を満たしたレポートを、合格の記録として台帳に足す。下回るときは作らない",
    "judge <資格コード>                  公開している選択式の問題ごとに、判定の基準に照らす判定の依頼を書く",
    "judge <資格コード> --import        判定役の出力を依頼と照合して取り込み、判定の結果(公開・書き直しで復帰できる・非公開)を書く",
    "judge-eval <資格コード>             人が承認した下書きから評価用のデータを作り、判定役の評価の依頼を書く",
    "judge-eval <資格コード> --import   判定役の出力を期待する判定と照合し、検出率・誤検出率などのレポートを書く",
    "restore <資格コード>                書き直した非公開の問題を、承認・検証・判定・同じ内容の確かめを通ったものだけ、同じ ID のまま公開の問題データへ戻す。何かに落ちたものは戻さない",
    "unpublish <資格コード>              判定の結果で、公開のままにしない問題を、公開の問題データから非公開のファイル(data/unpublished.<コード>.json)へ移す。出題の下限を下回る移し方は、何も書かずに止める",
    "reasons <資格コード>                不採用と差し戻しの理由を、理由コード・論点・段階ごとに集計し、下書きの指示の改善に使える形で書く。記録は変えない",
    "status <資格コード>                 段階ごとの状態(依頼待ち・取り込み待ち・通過・保留・不採用の件数、役のモデル)を表示する。読むだけ",
    "score <資格コード>                  公開している選択式の問題を、書き方の点数票(問題ごと・束)で採点する。読むだけ。本文は出さない",
    "rehash <資格コード>                 出典の本文のハッシュを、キャッシュの本文から新しい定義へ移し、台帳・事実カード・来歴・判断の記録を書き換える。再検証の印は付けない",
    "rehash <資格コード> --refetch       本文がキャッシュにない現在の出典を、取り直して、新しい定義のハッシュを採用する",
    "export <資格コード>                 承認し、検証を通った下書きを、data/ の問題データに書き出す",
    "",
    "終了コード: 0 成功 / 1 検査の失敗 / 2 入力の誤り / 3 内部の誤り",
    "",
  ].join("\n");
}

export async function main({ argv, env, output, configPath, rootDir, collectDeps }: MainOptions): Promise<ExitCode> {
  try {
    // 値を取るオプション: --domain=<分野のコード>(draft の依頼で、分野を 1 つに絞る)、
    // --targets=<候補>・--reason=<理由>(eval-sweep)、--role=<役>(eval-gate --record)
    const valueArgs = argv.filter((a) => VALUE_OPTION.test(a));
    const domainArgs = valueArgs.filter((a) => a.startsWith("--domain="));
    const flags = argv.filter((a) => a.startsWith("-") && !VALUE_OPTION.test(a));
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
      command?.name === "rehash" ||
      command?.name === "reasons" ||
      command?.name === "eval" ||
      command?.name === "eval-sweep" ||
      command?.name === "judge" ||
      command?.name === "judge-eval" ||
      command?.name === "unpublish" ||
      command?.name === "restore" ||
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
    const valueOptionName = (a: string) => `${a.slice(0, a.indexOf("=") + 1)}`;
    if (valueArgs.some((a) => !VALUE_OPTION_COMMANDS[valueOptionName(a)]?.includes(command.name))) {
      report(output, "不明なオプション");
      return EXIT.inputError;
    }
    // 値つきオプション: 空の値、--reason・--role の重複、--record のない --reason・--role は、入力の誤りにする
    const countOf = (name: string) => valueArgs.filter((a) => a.startsWith(name)).length;
    if (
      valueArgs.some((a) => a.endsWith("=")) ||
      countOf("--reason=") > 1 ||
      countOf("--role=") > 1 ||
      ((countOf("--reason=") > 0 || countOf("--role=") > 0) && !flags.includes("--record"))
    ) {
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
        verify: "使い方: verify <資格コード> [--import | --bundles]\n",
        status: "使い方: status <資格コード>\n",
        score: "使い方: score <資格コード>\n",
        rehash: "使い方: rehash <資格コード> [--refetch]\n",
        reasons: "使い方: reasons <資格コード>\n",
        eval: "使い方: eval <資格コード> [--import | --bundles]\n",
        judge: "使い方: judge <資格コード> [--import]\n",
        "judge-eval": "使い方: judge-eval <資格コード> [--import]\n",
        "eval-sweep":
          "使い方: eval-sweep <資格コード> --targets=<全体>/<種類ごと>/<誤検出の上限> [--targets=…] [--record --reason=<理由>]\n",
        "eval-gate": "使い方: eval-gate [--record --role=<verifier|judge>]\n",
        unpublish: "使い方: unpublish <資格コード>\n",
        restore: "使い方: restore <資格コード>\n",
        draft:
          "使い方: draft <資格コード> [--domain=<分野のコード> | --import | --check | --review | --decide | --revise | --rewrite]\n",
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
      if (flags.includes("--bundles")) return reportBundles(config, rootDir, "eval", examCode, output);
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
    if (command.name === "eval-sweep") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return runEvalSweep({
        config,
        rootDir,
        examCode,
        candidates: valueArgs.filter((a) => a.startsWith("--targets=")).map((a) => a.slice("--targets=".length)),
        record: flags.includes("--record"),
        reason: valueArgs.find((a) => a.startsWith("--reason="))?.slice("--reason=".length),
        dryRun,
        output,
        today: () => new Date().toISOString().slice(0, 10),
      });
    }
    if (command.name === "eval-gate") {
      return runEvalGate({
        config,
        rootDir,
        record: flags.includes("--record"),
        role: valueArgs.find((a) => a.startsWith("--role="))?.slice("--role=".length),
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
    if (command.name === "rehash") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return await runRehash({
        config,
        rootDir,
        examCode,
        refetch: flags.includes("--refetch"),
        dryRun,
        output,
        deps: collectDeps ?? defaultCollectDeps(config),
      });
    }
    if (command.name === "unpublish") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return runUnpublish({ config, rootDir, examCode, dryRun, output });
    }
    if (command.name === "restore") {
      const examCode = positional[1];
      if (examCode === undefined) {
        report(output, "入力の誤り", "資格コードの指定がない");
        return EXIT.inputError;
      }
      return runRestore({ config, rootDir, examCode, dryRun, output });
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
      if (flags.includes("--bundles")) return reportBundles(config, rootDir, "verify", examCode, output);
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
                : flags.includes("--rewrite")
                  ? "rewrite"
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

/** 待っている検証(または検証役の評価)の依頼を、検証役の 1 回の起動に渡す束に分けて表示する。読むだけ */
function reportBundles(
  config: Config,
  rootDir: string,
  stage: "verify" | "eval",
  examCode: string,
  output: Output,
): ExitCode {
  if (!EXAM_CODE.test(examCode)) {
    report(output, "入力の誤り", "資格コードの形");
    return EXIT.inputError;
  }
  const stamp = readAgentStampOrReport(output, rootDir, "question-verifier");
  if (stamp === null) return EXIT.checkFailed;
  const dir = join(resolve(rootDir, config.workDir), stage, examCode.toLowerCase());
  const attempts = readAttemptsFile(join(dir, "state.json"));
  const { bundles, invalid, exhausted, stale } = bundleRequests({
    rootDir,
    requestsDir: join(dir, "requests"),
    outDir: join(dir, "out"),
    size: config.verify.bundleSize,
    attempts,
    maxAttempts: stage === "verify" ? config.verify.maxAttempts : config.eval.maxAttempts,
    stamp,
  });
  const kind = stage === "verify" ? "検証の束" : "評価の束";
  for (const b of bundles) report(output, kind, `${b.check} ${b.files.length} 件 ${b.files.join(" ")}`);
  for (const path of invalid) report(output, "入力の誤り", `読めない依頼 ${path}`);
  if (exhausted > 0) report(output, "情報", `出し直しの回数が上限に達した依頼 ${exhausted} 件(束に入れない)`);
  if (stale > 0)
    report(
      output,
      "情報",
      `検証役の定義が依頼のあとに変わった依頼 ${stale} 件(束に入れない。依頼を書くコマンドが、新しい定義の依頼を書く)`,
    );
  report(output, "情報", `束 ${bundles.length} 個(束の大きさ ${config.verify.bundleSize} 件)`);
  return invalid.length > 0 ? EXIT.inputError : EXIT.ok;
}
