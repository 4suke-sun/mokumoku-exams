import { describe, expect, it } from "vitest";
import { PASSING, resolveProfile } from "./profiles.ts";
import {
  batchPasses,
  choiceForm,
  itemMax,
  QUESTION_ITEMS,
  questionPasses,
  type ScoreInput,
  scoreBatch,
  scoreQuestion,
} from "./score.ts";

const clf = resolveProfile("AWS-CLF-C02");
const dva = resolveProfile("AWS-DVA-C02");
const aib = resolveProfile("AWS-AIB-C01");
if (clf === null || dva === null || aib === null) throw new Error("帯がない");

/** 架空のサービス名と状況で作る、Cloud Practitioner の形の設問 */
const SHORT: ScoreInput = {
  id: "T-0001",
  type: "single",
  stem: "ある企業は、画像を長期間、低いコストで保存したいと考えています。この要件を満たすサービスはどれでしょうか。",
  choices: ["Amazon Foo Archive", "Amazon Bar Block", "Amazon Baz Compute", "Amazon Qux Queue"],
  correct: [0],
};

/** 架空のサービス名と状況で作る、Developer - Associate の形の設問(状況の段落と問いの段落を分ける) */
const LONG: ScoreInput = {
  id: "T-0002",
  type: "single",
  stem: [
    "ある企業は、Foo Function と Bar Table を組み合わせた注文受付のアプリケーションを運営しています。注文のたびに Foo Function が Bar Table へ書き込みます。",
    "最近になって、書き込みが集中する時間帯に、一部の注文が保存されないという報告が増えました。ログには、スロットリングのエラーが記録されています。",
    "開発者は、注文を取りこぼさずに保存する必要があります。運用の手間はできるだけ小さくしたいと考えています。",
    "",
    "この要件を満たす対応はどれでしょうか。",
  ].join("\n"),
  choices: [
    "Bar Table の書き込みキャパシティをオンデマンドモードに変更し、Foo Function の再試行の回数を増やす。",
    "Bar Table の書き込みキャパシティを固定で小さく設定し、Foo Function の同時実行数を増やす。",
    "Foo Function から Bar Table への書き込みをやめ、ログに注文の内容を出力してあとで取り込む。",
    "Bar Table の前に Qux Cache を置き、Foo Function は Qux Cache にだけ書き込むようにする。",
  ],
  correct: [0],
};

describe("選択肢の形", () => {
  it.each([
    ["Amazon Foo Archive", "name"],
    ["書き込みの削減", "phrase"],
    ["書き込みを減らす", "sentence"],
    ["書き込みを減らす。", "sentence"],
    ["再試行の回数を増やす", "sentence"],
  ] as const)("%s_%s と判定する", (text, form) => {
    expect(choiceForm(text)).toBe(form);
  });
});

describe("資格ごとの帯", () => {
  it("帯のある資格_ベンダー共通の帯に資格別の帯を重ねる", () => {
    expect(clf.stemLength.full).toEqual([35, 125]);
    expect(dva.stemLength.full).toEqual([150, 360]);
    expect(dva.openers).toEqual(clf.openers);
    expect(dva.points.questionParagraph).toBe(5);
    expect(clf.points.questionParagraph).toBe(0);
  });

  it("AI Business Strategist の帯_単一選択だけで_書き出しの語を資格別に持つ", () => {
    expect(aib.stemLength.full).toEqual([120, 300]);
    expect(aib.batch.multiShare).toEqual([0, 0]);
    expect(aib.separateQuestionParagraph).toBe(true);
    expect(aib.openers).not.toEqual(clf.openers);
    expect(aib.openers.some((o) => new RegExp(`^(?:${o})`).test("ある小売企業が小規模なチームを設立しました。"))).toBe(
      true,
    );
  });

  it("帯のない資格_null を返す", () => {
    expect(resolveProfile("EX-SMP-XX")).toBeNull();
    expect(resolveProfile("ZZZ-XXX-01")).toBeNull();
  });

  it.each([clf, dva])("どの資格でも_問題ごとの配点は共通 60 点と資格別 40 点で合計 100 点", (profile) => {
    const total = QUESTION_ITEMS.reduce((sum, item) => sum + itemMax(item, profile), 0);
    expect(total).toBe(100);
  });
});

describe("問題ごとの採点", () => {
  it("短い設問を Cloud Practitioner の帯で採点_満点になる", () => {
    const score = scoreQuestion(SHORT, clf);
    expect(score.lost).toEqual([]);
    expect(score.total).toBe(100);
    expect(questionPasses(score)).toBe(true);
  });

  it("長い設問を Developer - Associate の帯で採点_満点になる", () => {
    const score = scoreQuestion(LONG, dva);
    expect(score.lost).toEqual([]);
    expect(score.total).toBe(100);
  });

  it("状況と問いの間が空行でなく単なる改行_段落が分かれていないので段落の項目を減点する", () => {
    const joined = { ...LONG, stem: LONG.stem.replace(/\n\n/g, "\n") };
    expect(scoreQuestion(joined, dva).items.B7).toBe(0);
    expect(scoreQuestion(LONG, dva).items.B7).toBe(dva.points.questionParagraph);
  });

  it("長い設問を Cloud Practitioner の帯で採点_設問文の長さと状況の文の数で減点する", () => {
    const score = scoreQuestion(LONG, clf);
    expect(score.lost).toContain("B1");
    expect(score.lost).toContain("B2");
    expect(score.total).toBeLessThan(PASSING.question);
  });

  it("短い設問を Developer - Associate の帯で採点_長さ・状況・段落で減点して不合格になる", () => {
    const score = scoreQuestion(SHORT, dva);
    expect(score.lost).toEqual(expect.arrayContaining(["B1", "B2", "B7"]));
    expect(questionPasses(score)).toBe(false);
  });

  it("問いが常体の疑問で終わる_語尾の項目だけ減点する", () => {
    const polite = scoreQuestion(SHORT, clf);
    const plain = scoreQuestion({ ...SHORT, stem: SHORT.stem.replace("どれでしょうか。", "どれか。") }, clf);
    expect(polite.items.A1).toBe(5);
    expect(plain.items.A1).toBe(0);
    expect(plain.items.B6).toBe(0);
    expect(plain.blocked).toBe(false);
  });

  it("問いの末尾に句点があっても敬体_語尾の項目は満点", () => {
    expect(scoreQuestion({ ...SHORT, stem: SHORT.stem.replace("。", "") }, clf).items.A1).toBe(5);
    expect(scoreQuestion(SHORT, clf).items.A1).toBe(5);
  });

  it("複数選択の設問文の数が正答の数と違う_止める項目として扱う", () => {
    const multi: ScoreInput = {
      id: "T-0003",
      type: "multiple",
      stem: "ある企業は、保存したデータを守りたいと考えています。この要件を満たすものを 3 つ選択してください。",
      choices: ["Foo 暗号化", "Bar 複製", "Baz 監査", "Qux 圧縮", "Quux 分割"],
      correct: [0, 2],
    };
    const score = scoreQuestion(multi, clf);
    expect(score.items.A2).toBe(0);
    expect(score.blocked).toBe(true);
    expect(questionPasses(score)).toBe(false);
    expect(scoreQuestion({ ...multi, stem: multi.stem.replace("3 つ", "2 つ") }, clf).items.A2).toBe(10);
  });

  it("択一の設問文に 1 つ選ぶと書いてある_減点しない", () => {
    const score = scoreQuestion(
      { ...SHORT, stem: SHORT.stem.replace("どれでしょうか。", "1 つ選択してください。") },
      clf,
    );
    expect(score.items.A2).toBe(10);
  });

  it("択一の設問文に無関係な数の語がある_選ぶ数の項目で減点しない", () => {
    const stem = SHORT.stem.replace("画像を", "2 つの拠点の画像を");
    const score = scoreQuestion({ ...SHORT, stem }, clf);
    expect(score.items.A2).toBe(10);
    expect(score.blocked).toBe(false);
  });

  it("選択肢をまとめる選択肢がある_止める項目として扱う", () => {
    const score = scoreQuestion({ ...SHORT, choices: [...SHORT.choices.slice(0, 3), "上記のすべて"] }, clf);
    expect(score.items.A5).toBe(0);
    expect(score.blocked).toBe(true);
  });

  it("選択肢の文字数が極端に違う_バランスの項目を減点する", () => {
    const long =
      "Foo のしくみを使い、Bar と Baz を組み合わせて、保存の手順を自動化し、監査の記録も残し、利用者への通知も送る方法";
    const score = scoreQuestion(
      { ...SHORT, choices: [long, "Bar を使う方法", "Baz を使う方法", "Qux を使う方法"], correct: [1] },
      clf,
    );
    expect(score.items.A4).toBe(0);
  });

  it("括弧つきの略称を含む長い正式名のサービス名が並ぶ_長さの項目で減点しない", () => {
    const choices = [
      "Amazon Foo Archive Service (Amazon FAS)",
      "Bar",
      "Amazon Baz Identity and Access Management (Amazon BIAM)",
      "Qux",
    ];
    const score = scoreQuestion({ ...SHORT, choices, correct: [0] }, clf);
    expect(score.items.A4).toBe(10);
    expect(score.items.A10).toBe(5);
    expect(score.items.B4).toBe(clf.points.optionLength);
  });

  it("正答だけが際立って長い_偏りの項目を減点する", () => {
    const long = "Foo のしくみを使い、Bar と Baz を組み合わせて、保存の手順を自動化する方法";
    const score = scoreQuestion(
      { ...SHORT, choices: [long, "Bar を使う方法", "Baz を使う方法", "Qux を使う方法"], correct: [0] },
      clf,
    );
    expect(score.items.A10).toBe(0);
  });

  it("選択肢どうしがほぼ同じ文言_Cloud Practitioner では減点し Developer - Associate では許す", () => {
    const base = "Bar Table の書き込みキャパシティをオンデマンドモードに変更し、Foo Function の再試行の回数を増やす";
    const choices = [`${base}。`, `${base}こと。`, "Qux Cache を前に置く。", "ログに出力して、あとで取り込む。"];
    const input: ScoreInput = { ...LONG, choices };
    expect(scoreQuestion(input, clf).items.A7).toBe(0);
    expect(scoreQuestion(input, dva).items.A7).toBe(5);
  });

  it("状況の文があるのに要件の語がない_要件の項目を減点する", () => {
    const stem = "ある企業は、画像を保存する部署を持っています。サービスはどれでしょうか。";
    const score = scoreQuestion({ ...SHORT, stem }, clf);
    expect(score.items.B3).toBe(0);
  });

  it("状況の書き出しが決まった主体でない_書き出しの項目を減点する", () => {
    const stem = SHORT.stem.replace("ある企業は", "画像の保管を担当する部署では");
    expect(scoreQuestion({ ...SHORT, stem }, clf).items.B5).toBe(0);
  });

  it("状況の書き出しが英字と社の間に空白のある形_書き出しの項目を減点しない", () => {
    const stem = SHORT.stem.replace("ある企業は", "A 社は");
    expect(scoreQuestion({ ...SHORT, stem }, clf).items.B5).toBe(clf.points.opener);
  });

  it("採点結果_設問文や選択肢の本文を含まない", () => {
    const score = scoreQuestion(LONG, dva);
    const text = JSON.stringify(score);
    expect(text).not.toContain("注文");
    expect(text).not.toContain("Bar Table");
  });
});

/** 選択肢の形の組。名称・語句・文 */
const NAMES = ["Amazon Foo Archive", "Amazon Bar Block", "Amazon Baz Compute", "Amazon Qux Queue"];
const PHRASES = ["暗号化の設定", "複製の設定", "監査の記録", "圧縮の設定"];
const SENTENCES = ["暗号化を有効にする。", "複製を無効にする。", "監査の記録を消す。", "圧縮を外す。"];

describe("問いの言い回し", () => {
  const context = "ある企業は、画像を長期間、低いコストで保存したいと考えています。";
  it.each([
    "どの AWS サービスを使用すればよいですか。",
    "どうすればよいですか。",
    "どこで見つけることができますか。",
    "費用が安くなるのはなぜですか。",
    "AWS 側の責任である作業はどれですか。",
    "この要件を満たすサービスはどれでしょうか。",
    "対応する機能を選択してください。",
  ])("%s_敬体の問いとして拾う", (ending) => {
    const score = scoreQuestion({ ...SHORT, stem: context + ending }, clf);
    expect(score.items.A1).toBe(5);
    expect(score.items.B6).toBe(clf.points.questionEnding);
  });

  it.each([
    "この要件を満たす実装方法はどれでしょうか。",
    "この問題の根本的な原因として考えられる要因は何でしょうか。",
    "最も適切な設定方法を選択してください。",
  ])("%s_Developer - Associate でも同じ判定で敬体の問いとして拾う", (ending) => {
    const score = scoreQuestion(
      { ...LONG, stem: LONG.stem.replace("この要件を満たす対応はどれでしょうか。", ending) },
      dva,
    );
    expect(score.items.A1).toBe(5);
    expect(score.items.B6).toBe(dva.points.questionEnding);
  });

  it("Developer - Associate の問いが常体_語尾の項目を減点する", () => {
    const score = scoreQuestion(
      { ...LONG, stem: LONG.stem.replace("この要件を満たす対応はどれでしょうか。", "この要件を満たす対応はどれか。") },
      dva,
    );
    expect(score.items.A1).toBe(0);
    expect(score.items.B6).toBe(0);
  });

  it.each(["どれか。", "どのサービスを使うべきか。"])("%s_常体の問いとして減点する", (ending) => {
    expect(scoreQuestion({ ...SHORT, stem: context + ending }, clf).items.A1).toBe(0);
  });
});

describe("束の採点", () => {
  const stems = [
    "ある企業は、画像を長期間、低いコストで保存したいと考えています。この要件を満たすサービスはどれでしょうか。",
    "あなたは、複数の拠点のログを一か所に集めて検索したいと考えています。必要なサービスはどれですか。",
    "A 社は、全国の機器の稼働状況を常に把握する必要があります。利用するサービスはどれでしょうか。",
    "Foo というサービスが、クラウドの利用者に対して提供している役割として、最も正しいものはどれですか。",
    "ある会社は、請求の内訳を部門ごとに確認したいと考えています。使うべき機能はどれでしょうか。",
    "Bar を使うことで得られる利点を、運用の面から見て、最も適切に説明しているものはどれでしょうか。",
    "ある組織は、コードの変更を自動で配備する予定です。適切なサービスはどれですか。",
    "保存したデータの暗号化に使うことができる、鍵の管理を担当するサービスとして正しいものはどれでしょうか。",
    "ある企業は、通知を複数の宛先へ送る必要があります。この要件を満たすサービスはどれですか。",
    "Baz という名前のサービスが、利用者に対して提供している、計算の資源に関する機能はどれでしょうか。",
  ];

  const topics = [
    "ある企業は、画像",
    "あなたは、ログ",
    "A 社は、機器の記録",
    "ある会社は、請求の記録",
    "ある組織は、コード",
    "ある法人は、保存したデータ",
    "あなたは、顧客の情報",
    "B 社は、設計の資料",
    "ある企業は、通知の内容",
    "ある会社は、計算の結果",
  ];

  /** 10 問の組を 3 回並べた 30 問。選択肢の形は、名称 5・語句 3・文 2 の割合。5 問ごとに複数選択 */
  function conforming(): ScoreInput[] {
    return Array.from({ length: 30 }, (_, i) => {
      const k = i % 10;
      const choices = k < 5 ? NAMES : k < 8 ? PHRASES : SENTENCES;
      const multi = i % 5 === 0;
      return {
        id: `B-${i}`,
        type: multi ? "multiple" : "single",
        stem: multi
          ? `${topics[k]}を守りたいと考えています。なお、利用者の数は今後も増える見込みです。この要件を満たす設定を 2 つ選択してください。`
          : (stems[k] as string).replace(/^(.+。)([^。]+。)$/, "$1なお、利用者の数は今後も増える見込みです。$2"),
        choices: multi ? [...choices, "Quux 追加の設定"] : choices,
        correct: multi ? [0, 1] : [0],
      };
    });
  }

  it("設問の形が散らばった束_Cloud Practitioner の帯で合格する", () => {
    const score = scoreBatch(conforming(), clf);
    expect(score.items).toEqual({ S1: 20, S2: 20, S3: 20, S4: 20, S5: 20 });
    expect(batchPasses(score)).toBe(true);
  });

  it("全部が同じ書き出しの短い設問の束_Developer - Associate の帯では不合格になる", () => {
    const questions = Array.from({ length: 30 }, (_, i) => ({ ...SHORT, id: `S-${i}` }));
    const score = scoreBatch(questions, dva);
    expect(score.items.S2).toBe(0);
    expect(score.items.S3).toBe(0);
    expect(score.items.S5).toBe(0);
    expect(batchPasses(score)).toBe(false);
  });

  it("測定値_割合と文字数だけで本文を含まない", () => {
    const score = scoreBatch(
      Array.from({ length: 20 }, () => SHORT),
      clf,
    );
    expect(Object.keys(score.metrics).sort()).toEqual([
      "multiShare",
      "nameShare",
      "openerTopShare",
      "phraseShare",
      "sentenceShare",
      "situationShare",
      "stemMedian",
      "stemP90",
    ]);
  });
});
