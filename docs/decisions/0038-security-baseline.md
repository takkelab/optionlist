# 0038 公開に向けたセキュリティの土台（CSRF・CSP・回数の制限・metrics・連番 ID）

- 日付: 2026-11-08
- 状態: 確定（回数の制限の値は使って見直す）
- 対象: SPEC.md §3、api.md §1・§3・§6、architecture.md §2・§4、metrics.md §5、testing.md §2

## 決めたこと
- **CSRF**: Cookie は SameSite=Lax。`GET`・`HEAD` 以外は、`Origin` が自分のオリジンと一致しなければ 403 `FORBIDDEN` にする。JSON の API は `Content-Type: application/json` でなければ 400 にする
- **ヘッダー**: 画面には `Content-Security-Policy: default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'` を付ける。ほかに HSTS（1 年）、`Referrer-Policy: same-origin`、`X-Content-Type-Options: nosniff`、`Permissions-Policy`（カメラ・位置などを切る）を付ける。外のスクリプト・フォント・計測タグは読まない
- **回数の制限**（超えたら 429 `TOO_MANY_REQUESTS`）: アカウントの作成は 1 つの IP から 1 時間に 20 件まで、復旧コードの入力は 1 つの IP から 1 時間に 10 回まで（どちらも DB に数える。台数が増えても効くように）。写真の保存は 1 アカウント 1 時間に 60 回まで、そのほかの書き込みは 1 アカウントあたり 1 分に 120 回まで、アカウントなしでも受け取る `POST /api/events` は 1 つの IP から 1 分に 20 リクエストまで（この 3 つは台ごとのメモリで数える。画面の側の「1 分に 10 件」は改造した画面には効かないため、サーバーでも数える）
- **`/api/metrics`**: `Authorization: Bearer <METRICS_TOKEN>` が合わなければ 404 にする（あることも見せない）
- **`/api/health/db`**: 本番と確認用では `message` を返さない（接続先やエラーの中身を外に出さない）
- **ID は連番のまま**にする（0034）
- 依存の脆弱性は、今の `npm audit --audit-level=high`（metrics.md §2）に加えて、Dependabot で週 1 回 PR を出す

## 理由
- SameSite=Lax だけでも、別のサイトからのフォームの POST には Cookie が付かない。ただ、古いブラウザや同じサイトの中の別のサブドメインには効かないので、Origin も確かめる
- 外のスクリプトを読まないので、CSP を `'self'` だけにできる。電気通信事業法の外部送信の規律にも当たらない（利用者の端末から第三者に情報を送らない）
- アカウントの作成と復旧コードの入力は、総当たりと「アカウントの量産」の入口なので、台をまたいで数える。ほかは、台ごとに数えても足りる
- 連番の ID は、推測されても RLS と 404 で他人の行は読めない。漏れるのは全体のおおよその件数だけなので、UUID に変える手間（型・URL・テスト）に見合わない

## 影響
- SPEC.md §3 の「`/api/metrics` を同じ Wi-Fi の他の端末から見えないようにするか」は、トークンで閉じる
- エラーの種類に 403 `FORBIDDEN` と 429 `TOO_MANY_REQUESTS` を足す（api.md §3・§4）
