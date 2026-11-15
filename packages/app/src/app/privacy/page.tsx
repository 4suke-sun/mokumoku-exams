import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { ISSUES_URL } from "@/lib/site.ts";

export const metadata: Metadata = { title: "利用規約とプライバシーポリシー" };

/** 条文と項目の 1 つ分。見出しと本文をまとめる。 */
function Article({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="h3">{title}</h3>
      {children}
    </section>
  );
}

/** 番号付きの項目の一覧 */
function Items({ items }: { items: ReactNode[] }) {
  return (
    <ol className="list-decimal space-y-1 pl-6">
      {items.map((item, index) => (
        // 固定の文言の並びで、並べ替えも追加も起きないため、位置を key にする
        // biome-ignore lint/suspicious/noArrayIndexKey: 固定の並び
        <li key={index}>{item}</li>
      ))}
    </ol>
  );
}

/** 利用規約とプライバシーポリシー。ログインなしで開ける読み物の 1 ページ。 */
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-10">
      <h1 className="h1">利用規約とプライバシーポリシー</h1>

      <section className="space-y-6" aria-labelledby="terms">
        <h2 id="terms" className="h2">
          利用規約
        </h2>
        <p>
          この利用規約(以下「本規約」)は、もくもく問題集(以下「本サービス」)の利用の条件を定めるものです。利用者は、本規約に同意したうえで本サービスを使うものとします。アカウントを登録した時点で、本規約とプライバシーポリシーに同意したものとみなします。
        </p>

        <Article title="第 1 条(本サービス)">
          <Items
            items={[
              "本サービスは、クラウドの資格の試験の学習のために、問題を解き、間違えた問題を復習できる Web サービスです。",
              "本サービスは、資格の試験の主催者とは関係のない、非公式の学習サービスです。",
              "本サービスは無料で提供します。",
            ]}
          />
        </Article>

        <Article title="第 2 条(アカウント)">
          <Items
            items={[
              "利用者は、メールアドレスとパスワードでアカウントを登録し、メールに届く確認コードで登録を確かめます。",
              "利用者は、自分のメールアドレスで登録し、パスワードを自分で管理するものとします。アカウントを第三者に使わせてはいけません。",
            ]}
          />
        </Article>

        <Article title="第 3 条(禁止事項)">
          <p>利用者は、次の行為をしてはいけません。</p>
          <Items
            items={[
              "法令または公序良俗に反する行為",
              "他人のメールアドレスを使って登録する行為",
              "本サービスのサーバーやネットワークに過度な負荷をかける行為、不正にアクセスする行為",
              "自動化した手段で、登録や確認コードの送信を繰り返す行為",
              "そのほか、本サービスの運営を妨げる行為",
            ]}
          />
        </Article>

        <Article title="第 4 条(利用の制限)">
          <p>
            運営者は、利用者が本規約に反したとき、または悪用が疑われるときは、予告なく、そのアカウントを無効にできます。
          </p>
        </Article>

        <Article title="第 5 条(本サービスの変更・中断・終了)">
          <p>
            運営者は、予告なく、本サービスの内容を変更し、または提供を中断・終了できます。保守、障害、利用している外部のサービスの都合による中断を含みます。
          </p>
        </Article>

        <Article title="第 6 条(内容の正確さ)">
          <p>
            本サービスの問題と解説は、学習の補助として提供するものです。運営者は、その正確さ、完全さ、最新であること、試験への合格を保証しません。
          </p>
        </Article>

        <Article title="第 7 条(免責)">
          <p>
            運営者は、本サービスの利用によって利用者に生じた損害について、責任を負いません。ただし、運営者の故意または重大な過失による場合は、この限りではありません。
          </p>
        </Article>

        <Article title="第 8 条(退会)">
          <p>
            利用者は、アカウントの画面の「退会する」から、いつでも退会できます。退会すると、アカウントと、サーバーの学習の記録と、通知の購読と、退会に使った端末の学習の記録を消します。
          </p>
        </Article>

        <Article title="第 9 条(本規約の変更)">
          <p>
            運営者は、必要に応じて本規約を変更できます。変更した本規約は、このページに掲示した時点から効力を持ちます。
          </p>
        </Article>

        <Article title="第 10 条(準拠法)">
          <p>本規約は、日本法に従って解釈します。</p>
        </Article>
      </section>

      <section className="space-y-6" aria-labelledby="privacy">
        <h2 id="privacy" className="h2">
          プライバシーポリシー
        </h2>
        <p>本サービスは、利用者の情報を、次のとおり扱います。</p>

        <Article title="1. 取得する情報">
          <Items
            items={[
              "メールアドレス(ログインと確認コードの送信に使います)。パスワードは、認証の仕組みの中で保管し、運営者が読むことはできません。",
              "学習の記録(解いた結果、ブックマーク、復習、日ごとの学習量、目標日、表示の設定など)",
              "通知を購読したときの、購読の情報",
              "お問い合わせと問題の誤りの報告のフォームで送った内容と、送った件数(1 日の上限を数えるため)",
              "サーバーの動作の記録(エラーの内容など)",
            ]}
          />
        </Article>

        <Article title="2. 端末に保存する情報">
          <div className="overflow-x-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="border border-line px-2 py-1 text-left">種類</th>
                  <th className="border border-line px-2 py-1 text-left">中身</th>
                  <th className="border border-line px-2 py-1 text-left">目的</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="border border-line px-2 py-1">Cookie</td>
                  <td className="border border-line px-2 py-1">
                    ログインの状態(読み取りをブラウザのスクリプトに許さない形)、表示の設定
                  </td>
                  <td className="border border-line px-2 py-1">ログインを保つ、表示をそろえる</td>
                </tr>
                <tr>
                  <td className="border border-line px-2 py-1">ブラウザの保存領域</td>
                  <td className="border border-line px-2 py-1">
                    資格ごとの学習の記録(解いている途中の状態、結果、段階の到達、セクションの進捗、出題の条件)、表示の設定、解答の表示のしかた、お知らせを読んだか
                  </td>
                  <td className="border border-line px-2 py-1">続きから解く、記録を表示する、設定を保つ</td>
                </tr>
              </tbody>
            </table>
          </div>
        </Article>

        <Article title="3. 取得しない情報">
          <p>
            アクセス解析や広告のためのツールは使っていません。接続元の IP
            アドレスなどのアクセスのログは、集めていません。
          </p>
        </Article>

        <Article title="4. 利用目的">
          <Items
            items={[
              "ログインと本人の確認、確認コードの送信",
              "学習の記録の保存と表示",
              "通知の送信",
              "お問い合わせと問題の誤りの報告の受け付け",
              "不具合の調査と、悪用の防止",
            ]}
          />
          <p>広告には使いません。</p>
        </Article>

        <Article title="5. 第三者への提供">
          <p>本人の同意がある場合と、法令に基づく場合を除き、第三者に提供しません。</p>
        </Article>

        <Article title="6. 外部のサービスの利用">
          <Items
            items={[
              "本サービスは、クラウドのサービス(Amazon Web Services)の上で動いています。アカウント、学習の記録、確認コードのメールの送信は、このサービスを使います。",
              "通知を購読したときは、通知を届けるために、ブラウザの提供元のプッシュの仕組みへ、購読の情報と通知の本文を送ります。",
              "お問い合わせと問題の誤りの報告のフォームで送った内容は、GitHub に、このサービスのリポジトリの Issue として保存します。リポジトリは公開されることがあり、そのときは、だれでも読めます。送った人のメールアドレスと、利用者を見分ける識別子は、Issue に書きません。",
            ]}
          />
        </Article>

        <Article title="7. 保存期間">
          <Items
            items={[
              "アカウントと学習の記録は、退会するまで保存します。",
              "確認コードの入力が済んでいないアカウントは、作成から 24 時間がたったあと、同じメールアドレスで、違うパスワードで登録し直したときに置き換わります。",
              "サーバーの動作の記録は、30 日で消えます。",
              "フォームで送った内容は、Issue として残り、退会しても消えません。送った件数の記録は、退会で消えます。",
              "管理者が利用者を無効にした操作の記録には、退会のあとも、利用者を見分ける識別子が残ります。この識別子は、メールアドレスではありません。",
            ]}
          />
        </Article>

        <Article title="8. 削除">
          <p>
            アカウントの画面の「退会する」で、アカウントと、サーバーの学習の記録と、通知の購読と、退会に使った端末の学習の記録を消せます。問い合わせをしなくても消せます。フォームで送った内容は、退会しても消えません。
          </p>
        </Article>

        <Article title="9. 改定">
          <p>
            必要に応じて、このポリシーを改定します。改定したポリシーは、このページに掲示した時点から効力を持ちます。
          </p>
        </Article>

        <Article title="10. 問い合わせ">
          <p>
            ログインしたうえで、
            <Link href="/contact" className="text-primary underline">
              お問い合わせのフォーム
            </Link>
            から送れます(問題の誤りは、問題の下の「この問題の誤りを報告」から送れます)。返信はしません。
          </p>
          <p>
            送った内容は、
            <a href={ISSUES_URL} className="text-primary underline" rel="noopener noreferrer">
              このサービスのリポジトリの Issue
            </a>
            として起票され、公開されることがあります。メールアドレスなどの個人情報は書かないでください。
          </p>
        </Article>
      </section>

      <p className="text-right text-sm">
        2026 年 11 月 6 日 制定
        <br />
        2026 年 11 月 15 日 改定
      </p>
    </article>
  );
}
