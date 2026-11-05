import type { Metadata } from "next";
import { ISSUES_URL } from "@/lib/site.ts";

export const metadata: Metadata = { title: "プライバシーと利用条件" };

/** 集める情報と使い道、消し方、利用条件、問い合わせ先。ログインなしで開ける読み物の 1 ページ。 */
export default function PrivacyPage() {
  return (
    <article className="mx-auto max-w-2xl space-y-8">
      <h1 className="h1">プライバシーと利用条件</h1>

      <section className="space-y-3">
        <h2 className="h2">集める情報</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>メールアドレス(ログインに使います)。</li>
          <li>学習の記録(解いた結果、ブックマーク、復習、日ごとの学習量、目標日、表示の設定など)。</li>
          <li>通知を購読したときの、購読の情報。</li>
        </ul>
        <p>
          接続元の IP
          アドレスなどのアクセスのログは、集めていません。サーバーの動作の記録(エラーの内容など)は、不具合を調べるために
          30 日のあいだ残し、そのあと消えます。
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="h2">使い道</h2>
        <p>
          集めた情報は、ログインと、学習の記録の保存と表示、通知の送信だけに使います。広告には使いません。第三者には渡しません。
        </p>
        <p>
          ただし、通知を購読したときは、通知を届けるために、ブラウザの提供元のプッシュの仕組みへ、購読の情報と通知の本文を渡します。
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="h2">退会のあとに残るもの</h2>
        <p>
          管理者が利用者を無効にした操作の記録には、利用者を見分ける識別子が残ります。この識別子は、メールアドレスではありません。
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="h2">消し方</h2>
        <p>アカウントの画面の「退会する」で、アカウントと、学習の記録と、通知の購読を消せます。</p>
      </section>

      <section className="space-y-3">
        <h2 className="h2">利用条件</h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>問題と解説の正しさと、サービスの継続は保証しません。</li>
          <li>利用によって生じた損害の責任は負いません。</li>
          <li>悪用が疑われるアカウントは、予告なく無効にすることがあります。</li>
        </ul>
      </section>

      <section className="space-y-3">
        <h2 className="h2">問い合わせ</h2>
        <p>
          <a href={ISSUES_URL} className="text-primary underline" rel="noopener noreferrer">
            このサービスのリポジトリの Issue
          </a>
          で受け付けます。
        </p>
        <p>
          Issue
          は、だれでも読める公開の場です。メールアドレスなどの個人情報は書かないでください。データを消したいときは、問い合わせをせずに、上の「消し方」の操作で消せます。
        </p>
      </section>
    </article>
  );
}
