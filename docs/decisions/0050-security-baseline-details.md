# 0050 API のセキュリティの土台の細部（R4）

- 日付: 2026-11-09
- 状態: 確定（回数の制限の値は 0038 のとおり、使って見直す）
- 対象: api.md §1・§6、architecture.md §3・§4.2・§4.3、testing.md §2・§5

## 決めたこと
- **Origin がない書き込みも 403** にする（`GET`・`HEAD` 以外）。`Origin: null` も 403
- 自分のオリジンは `APP_ORIGIN`（パスのないオリジン）。手元・テストで `APP_ORIGIN` がないときは、リクエストの `Host` から作ったもの（`http://<Host>`）と比べる。`APP_ENV` が staging / production で `APP_ORIGIN`・`METRICS_TOKEN`・`IP_HASH_SECRET` のどれかがなければ、起動の時点で止める
- **Content-Type は、本文のある書き込みだけ**を見る。写真のアップロード（`PUT /api/achievements/:id/photo`）は `multipart/form-data`、ほかは `application/json` でなければ 400。本文のない書き込み（`DELETE`・達成の記録・復旧コードの発行）は、Content-Type を問わない
- Express の **`strict routing` と `case sensitive routing` を有効**にする。ルートは書いたとおりのパスにだけ当たる（`/api/events/`・`/API/events` は 404）
- 書き込みの回数の制限（メモリ）は、Origin と Content-Type の確認とセッションのあとに数える。`POST /api/account/restore` は DB で数えるので、メモリでは数えない。写真の保存は、R5 で 1 時間 60 回の枠に分けるまで「そのほかの書き込み」（1 分 120 回）に入れる。断った書き込みも 1 回に数える（固定の窓なので、`Retry-After` のとおりに待てば通る）
- 回数の制限の鍵の IP は、台のメモリにだけ置き、HMAC しない（DB にもログにも出さない）
- `/api/metrics` は、トークンが合わないとき、どのルートにも当たらないときと同じ本文の 404 を返す。`METRICS_TOKEN` が空なら、いつも 404
- ログ（`backend/src/infra/JsonLogger.ts`）は、出すキーを決めた形（`severity`・`message`・`kind`・`route`・`status`・`durationMs`・`error`）に限る。`error` は `name`・`message`・`code`・`stack` だけにする。文字列のうち、Cookie の値（`ol_session=…`・43 文字の base64url）と復旧コードの形（4 文字 × 4。区切りはハイフン・空白・なし）を `[redacted]` に置き換える。`route` はルートの定義（`/api/options/:id`）にする。写真のファイル名とアカウントの ID は `message` に入れない

## 理由
- Origin がないとき: 今のブラウザ（Chrome・Safari・Firefox）は、同じオリジンの `fetch` の書き込みにも Origin を付ける。Origin のない書き込みはブラウザの外（curl など）から来るので、通しても CSRF にはならないが、通す理由もない。api.md §1 の「一致しなければ 403」を文字どおりに守り、例外を作らない
- 手元で Host と比べる: Vite の proxy を `changeOrigin: false` にして Host を書き換えないようにしたので（文字列だけで書くと Vite は `changeOrigin: true` にし、Host が backend のものになって E2E の書き込みが 403 になった）、`dev`（5173）・E2E（4174）・`dev:lan`（PC の IP）のどれでも、画面の Origin と Host が一致する。手元の環境ごとに `APP_ORIGIN` を書き分けなくてよい。本番は Host を信じず、決めた値と比べる
- 本文のある書き込みだけ: axios は本文のない `POST`・`DELETE` に Content-Type を付けない。すべての書き込みに求めると、画面の正しい操作が 400 になる。JSON の API に本文なしで来たものは、入力の検証で 400 になる
- strict・case sensitive: Origin の確認・回数の制限は、パス（`/api/` で始まるか、`/api/events` か）で判定する。Express の既定では `/API/events` や `/api/events/` も同じルートに当たるので、判定をすり抜けて、Origin なし・回数の制限なしで書き込めた（reviewer の指摘）。判定の側で正規化するより、ルートに当たるパスを 1 つにする方が漏れがない
- ログの伏せ字: キーを限るだけでは、エラーの `message`（pg の制約違反の文、Express が拾った URL など）に Cookie やコードが混ざるのを防げない。pg の `detail` には行の中身（タイトル）がそのまま入るので捨てる。復旧コードの形は、区切り（空白・ハイフン・全角のハイフンと長音）がいくつ混ざっていても、4 文字ずつのまとまりなら伏せる。英単語 4 つの並びなども伏せてしまうが、漏らすよりよい
- 回数の制限の IP: `trust proxy`（R7）を入れるまでは、Cloud Run の上で全員が前段のプロキシの IP に見え、`POST /api/events` の 1 分 20 回を全員で分け合ってしまう。確認用に出す R8 より前の R7 で入るので、ここでは入れない

## 影響
- backend: `middleware/ApiGuards.ts`（`ApiNoStore`・`OriginGuard`・`JsonContentType`）、`middleware/WriteRateLimit.ts`、`services/RateLimiter.ts`、`infra/AppConfig.ts`、`infra/JsonLogger.ts`。`Logger` は `error(entry)`・`info(entry)` の形に変えた
- テスト: `tests/api/security.test.ts`、`tests/unit/json-logger.test.ts`・`rate-limiter.test.ts`・`app-config.test.ts`。書き込みのテストは `TestRequests`・`SessionAgent` で `Origin: http://test.local` を付ける。E2E は `extraHTTPHeaders` で画面と同じ Origin を付ける（`page.request` の種まきは Origin を付けないため）
- 性能テストは、同じ人・同じ IP で何百回も書くので、回数の制限を外した TestApp で測る
- `.github/dependabot.yml`（npm 3 か所と GitHub Actions、週 1 回）
