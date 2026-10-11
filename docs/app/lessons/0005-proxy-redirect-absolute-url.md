# Next.js の proxy で返すリダイレクトは、絶対 URL にする

## 注意すること

`proxy.ts`(旧 middleware)でリダイレクトを返すときは、`NextResponse.redirect()` に、リクエストの URL を基準にした絶対 URL を渡す。`Location` ヘッダーに相対のパスを手で入れた応答を返さない。

## 理由

Next.js は、proxy が返した `Location` を、リクエストの URL と照らして相対の形に直す。相対のパスのままだと、この変換で `Invalid URL` になり、リダイレクトの代わりに 500 の応答になる。単体テストで proxy の関数を直接呼ぶだけでは、この変換を通らないため、気づけない。

## 対処

- `new URL("/login", request.url)` のように、リクエストの URL を基準に URL を作り、`NextResponse.redirect(url, { status: 307 })` で返す。
  同じホストのものは、Next が相対の `Location` に直して返すので、CloudFront の背後でホストが違っていても、外には出ない。
- proxy を変えたときは、開発サーバーを起動して、未ログインのリクエストで `curl -i` の応答(ステータスと `Location`)を確かめる。
