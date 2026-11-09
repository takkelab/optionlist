# 0052 PWA とポリシー・規約のページの細部（R6）

- 日付: 2026-11-09
- 状態: 確定（問い合わせ先は仮。R11 で差し替える）
- 対象: screens.md §2・§7・§9・§10、testing.md §5、process.md §5（R11）

## 決めたこと
- アイコンは、白地に装飾の色（tokens.css の `--deco-1`〜`--deco-10`）を輪の順に並べた**虹の輪**（`frontend/public/favicon.svg`）。maskable の安全域（中央 80%）に収める。PNG（64・192・512・maskable 512・apple-touch 180）と favicon.ico はコミットせず、ビルドのときに vite-plugin-pwa の `pwaAssets`（`@vite-pwa/assets-generator`）が SVG から作る。SVG が安全域に収まっているので、余白は足さない（`padding: 0`）
- Service Worker は `registerType: 'prompt'` で、更新の表示は出さない。`skipWaiting` しないので、新しい版は待たされ、画面をすべて閉じて次に開いたときに切り替わる。`clientsClaim` は付ける（初めて入ったときに、開いている画面も受け持つ）
- 画面の移動は、`/api/` 以外の要求を `NetworkFirst`（キャッシュ名 `pages`、20 件まで）にして決める（JS・CSS・アイコンは先にキャッシュしたものが先に当たる）。キャッシュは URL ごとなので、**オフラインで開けるのは、Service Worker が入ったあとに通信できるときに開いた画面だけ**。初めて開いた回の要求は Service Worker を通らないので入らず、そのあとの移動はアプリの中で済んで通信しないので、2 回目に開いたときに入る
- ポリシー・規約のページは、開いたときにスクロールを先頭に戻す（アプリには、移動でスクロールを戻す仕組みがない）
- ポリシーで「東京リージョンに保存する」と書くのは、利用者が入力したデータ（やりたいこと・達成・写真）に限る。アクセスのログ（Cloud Logging）の保存場所は R8 で決め、国内に置けなければポリシーの文面を直す
- 失敗のトーストは、`navigator.onLine` が false なら、何の失敗でも「通信できませんでした。電波のよいところでもう一度お試しください」にする（`lib/FailureMessage.ts`）。`client_error` には元の文言を送る
- 設定のシートのポリシー・規約へのリンクは `replace` で移る（シートが積んだ履歴〈`useBackToClose`〉をページに置き換え、ページからの戻る 1 回で一覧に戻る）。ページの戻るボタンは、URL を直接開いたとき（履歴の最初）だけやりたいリストへ移る
- 追加ダイアログの注記は、ダイアログを開くたびに `GET /api/account` を読み、アカウントがないときだけ出す
- ポリシー・規約のページは、別の chunk に分けない（`React.lazy` はトップレベルで関数を渡す形になり L5 に当たる。文面は数 KB で、初期表示の JS は 200KB の目標に余裕がある）。問い合わせ先はリンクにせず、選んでコピーできる文字にする（44px に満たない小さなリンクを本文に置かない）
- 運営者は **takkelab**。問い合わせ先は仮の `contact@example.invalid` にし、R11 で専用のアドレスに差し替える（R11 の完了の条件で確かめる）
- E2E は、設定で Service Worker を止め（`serviceWorkers: 'block'`）、`pwa.spec` だけで許す。オフラインは `context.setOffline`（CDP の通信の設定は、Service Worker の通信には効かないため）で作る
- `pwa.spec` が確かめるのは「通信できるときに Service Worker が画面を通信で取りに行く」ことと、`index.html` を先にキャッシュしていないことまで。キャッシュを先に出していない（StaleWhileRevalidate でない）ことは、応答を差し替えないと見分けられず、差し替えは L3 で禁じているので確かめない（設定の `handler: 'NetworkFirst'` で決める）

## 理由
- 画面の移動を URL ごとにしたのは、どの URL でも `index.html` のキャッシュを返す形（`navigateFallback`）にすると、通信を先に試す形と両立させるのに Workbox のプラグインを書く必要があり、vite.config.ts では lint（L5）に当たるため。オフラインで開くのは、ホーム画面のアイコンから `/` を開く場合がほとんどで、困らない
- 更新の表示を出さないのは screens.md §10 のとおり。`skipWaiting` で今の画面のうちに切り替えると、開いている画面の JS と新しい版のファイルが食い違いうる
- E2E で Service Worker を止めるのは、キャッシュした画面の殻がほかのテストの結果を変えないようにするため（シナリオ 14 だけが確かめる）

## 影響
- `npm run dev` では Service Worker は出ない。確かめるのは `npm --prefix frontend run build` → `npm --prefix frontend run preview`
- vite-plugin-pwa 2.0.0 の依存（workbox-build の glob・minimatch など）に moderate の脆弱性がある。ビルドのときだけ使う開発用の依存で、CI が止める high 以上ではない（metrics.md §2）。Dependabot の更新で直す
