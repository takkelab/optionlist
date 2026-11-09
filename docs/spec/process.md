# 開発プロセス

[SPEC.md](../../SPEC.md) の一部。

## 1. 進め方
- 実装は 1 ステップ（§4・§5）＝ 1 ブランチ ＝ 1 PR で進める。§4 は提出版（自分 1 人・手元だけ）までの順番で、実装済み。一般向けのリリースは §5 の順に進める
- 各ステップは新しいセッションで始め、Plan Mode で計画してから実装する。読むのは SPEC.md と、目次の「読むとき」に当てはまる章だけでよい
- PR をマージできるのは次をすべて満たしたとき
  - CI がすべて通る（metrics.md の「CI 失敗」の指標を満たす）
  - reviewer サブエージェントが SPEC と照らし合わせて、正しさに関わる指摘がない（AI が納得するまで ready にしない）
  - PR 本文の「詰まった点と再発防止策」が埋まっている（§2。なければ「なし」と書く）
  - 仮決めや目標値を変えたなら、docs/decisions/ に記録がある（§3）
- マージは `npm run pr:merge -- <PR 番号>` で行う。CI（`quality`・`pr-check`・`image`）の最新の結果がすべて緑のときだけマージする。GitHub の画面や `gh pr merge` で直接マージしない（ブランチ保護が使えないため。docs/decisions/0004）
- ステップの開始時に、Claude の使用量表示（5 時間枠・週の使用率）を控える。マージ後に同じ値をもう一度控え、metrics.md §7 の値と一緒に `docs/metrics/ai-usage.md` に記録する

## 2. AI が詰まったときの再発防止
AI が何かに詰まり、力ずくで解決したときは「解決したからよし」で流さず、仕組みで再発を防ぐ。

1. ステップの終わりに、AI の行動履歴から詰まった箇所を洗い出す（同じコマンドの繰り返し、エラーの回避策、試行錯誤など）
2. 「なぜ詰まったのか」を AI に答えさせ、原因を特定する
3. 次の優先順位で対策を選ぶ。上の方法が使えない理由があるときだけ下に進む
   1. **実行環境を見直す**: そもそも問題が起きないようにする（設定、依存、ポート、npm scripts、`.claude/settings.json` の権限やフックなど）
   2. **lint・テスト・型で縛る**: 違反したら機械的に失敗するようにする
   3. **手順をスクリプトにする**: 毎回同じ手順を踏むものは、1 コマンドで済むようにする
   4. **スキルを書く**: 機械化が難しいときの最終手段
   5. CLAUDE.md・rules への追記は効き目が弱いので、1〜4 の補足としてだけ使う
4. `docs/harness/incidents.md` に記録する（日付、起きたこと、原因、対策の種類、対策の内容、再発したかを確かめる方法）
5. PR 本文の「詰まった点と再発防止策」に要約を書く（PR テンプレートに欄を作り、空なら CI で失敗させる）

例: CLAUDE.md の Gotchas にある「8000 番ポートが別アプリと衝突する」は、文章で注意するのではなく、backend の起動時にポートの使用状況を確かめて、わかりやすいメッセージで止めるようにする（優先順位 1）

## 3. 仕様変更の記録（docs/decisions/）
- **SPEC（SPEC.md と docs/spec/）は「今の正しい仕様」だけを書く**。なぜそうなったかの経緯は docs/decisions/ に書く
- 記録するもの
  - 「※仮決め」の項目を確定・変更したとき
  - metrics.md の目標値を追加・変更したとき
  - architecture.md §2 のルールの例外・許可リストを増やしたとき
  - そのほか、後から「なぜこうした？」と聞かれそうな判断
- 書き方は [docs/decisions/README.md](../decisions/README.md) のテンプレートに従う。1 件 1 ファイル、数行でよい
- SPEC の修正と decisions の追加は同じ PR で行う。`metrics.config.json` を変えた PR に decisions の追加がなければ CI で失敗させる

## 4. 実装の順番（提出版。実装済み）
ステップ 1 は量が多いので 3 つに分ける。

1. **計測とハーネスの土台**
   - 1a. CI と計測: GitHub リポジトリ、GitHub Actions（MySQL サービスコンテナ）、`metrics.config.json`、品質チェックスクリプト、カバレッジ、PR テンプレートと PR の検査、`docs/harness/incidents.md`
   - 1b. lint ハーネス: architecture.md §2 の自作 lint ルールとそのテスト、backend への oxlint の導入、`shared/` の設定
   - 1c. 雛形のクラス化: architecture.md §3 のフォルダ構成に合わせて雛形を直す、共通エラーハンドラ、`/api/metrics`、8000 番ポートの衝突チェック
2. **DB**: dbmate の導入、5 テーブルと提案 100 件のマイグレーション、マイグレーションテスト、テスト用 DB の仕組み、性能用データの生成スクリプト
3. backend: options の API（一覧・追加・詳細・更新・削除・並び替え）、UT、API テスト、性能テスト
4. frontend: デザイントークン、ルーティング、Context、タブバー、やりたいリスト、追加ダイアログ、Playwright の導入
5. 項目のシート: 予定日、AI に相談、タイトル編集、削除（詳細画面とメモ・リンクは 0014 でやめた）
6. 完了フロー: 達成記録 API、🎉、アニメーション、やったリスト、戻す操作
7. 提案（docs/decisions/0020 で「スワイプで判定」から「探して歩く」に変えた。量が多いので 2 つに分ける）
   - 7a. **データと API**: テーマ・タグ・季節・一歩の大きさのマイグレーション、提案の中身（先に 10 件ほどの見本で書き方をユーザーと合わせてから全件。豆知識の事実は確かめる）、一覧・1 件の API（metrics.md §4 の「SQL 3 本以内」に収まるよう、タグはまとめて読む）、UT・API テスト・性能テスト（性能用データに提案から追加した option と `suggestion_view` のイベントを入れ、`suggestion_skip` をやめる）
   - 7b. **画面**: 探す画面・提案 1 件の画面・タグの一覧、追加、E2E
8. 達成の写真（docs/decisions/0028 で、達成 1 回に 1 枚と決めた）
9. ドラッグ＆ドロップ並び替え
10. 利用イベントの送信と `npm run metrics:usage`

各ステップで、そのステップに関係する metrics.md の指標をすべて満たすこと。

## 5. リリースの実装の順番
一般向けに公開するための順番（docs/decisions/0032〜0046）。§1 の進め方（1 ステップ ＝ 1 ブランチ ＝ 1 PR、Plan Mode、reviewer、`npm run pr:merge`、使用量の記録）はそのまま使う。
各ステップの「完了の条件」はコマンドで確かめられる形で書く。PR 本文に、そのコマンドと結果（終了コード・件数）を貼る。`<確認用のドメイン>`・`<本番のドメイン>` は R8 で決めたものに置き換える。

### 共通の完了の条件（どのステップでも）
```sh
npm run typecheck && npm run lint && npm run test:lint-rules && npm test \
  && npm --prefix backend run test:migrations && npm run test:e2e && npm run metrics:check
```
- CI（`quality`・`pr-check`・`image`）がすべて緑で、`npm run pr:merge -- <PR 番号>` でマージできること
- そのステップで変えた仕様の章と docs/decisions/ が、同じ PR で直っていること（§3）
- CLAUDE.md の Commands・Gotchas が、そのステップのあとのやり方に合っていること

### R1. Postgres に移る（docs/decisions/0034・0044）
- 提案のマスターデータを `backend/tests/migrations/fixtures/suggestions-mysql-final.json` に書き出す（MySQL の最後の提案のマイグレーションの INSERT から作る。手元の MySQL は別の PC にあるので、ダンプと `backend/uploads/` の保存はここではしない。docs/decisions/0044・0047）
- `pg` に乗り換え、MySQL の 13 本のマイグレーションを、Postgres の基準のマイグレーション 1 本にまとめ直す（ユーザーはまだ足さない。表の形は今のまま、型だけ data.md §1 に合わせる）
- `?` を `$1` に、`INSERT … SET ?` を列を並べる形に、エラーコードを SQLSTATE（`23505`・`23503`）に直す。`date` を文字列のまま受ける。接続ごとに `TimeZone=UTC`
- CI のサービスコンテナを `postgres:17` に。マイグレーション・性能のテストを Postgres 向けに（`EXPLAIN` の `Seq Scan`）
- `.claude/settings.json` の Stop hook を node のスクリプト（`scripts/stop-hook.ts`）にし、依存（ルート・backend・frontend の `node_modules`）がなければ「CLAUDE.md の初回の手順を流す」と出して止める（docs/harness/incidents.md #18）
- 完了の条件
  - 共通の条件
  - `scripts/tests/stop-hook.test.ts` が通る（`npm run test:scripts`。依存がないフォルダでメッセージを出して止まる）
  - `git grep -n -i "mysql" -- backend/src backend/package.json package.json .github scripts` が 0 件（終了コード 1）
  - `ls backend/db/migrations | wc -l` が 1
  - `npm --prefix backend run test:file -- tests/migrations/migrations.test.ts` が通り、その中で `suggestions-mysql-final.json` と ID・中身が一致する

### R2. 匿名アカウントとデータの分離（docs/decisions/0033・0034・0046）
- users・auth_attempts の表、options・achievements の `user_id`、(user_id, suggestion_id) の UNIQUE、複合外部キー、(user_id, …) のインデックス
- ロール（`ol_migrator`・`ol_app`・`ol_cleanup`・`ol_metrics`・`ol_definer`・`ol_incident`）を作るスクリプト（`npm --prefix backend run db:roles` / `db:roles:test`）、RLS のポリシー、認証の関数のうち `auth_find_user`・`auth_create_user`（data.md §4。`auth_restore` は R3。docs/decisions/0048）
- `UserScopedDatabase` とセッションの middleware（Cookie、最初の `POST /api/options` でアカウントを作る、1 日 1 回の `last_seen_at`）。アカウントの作成の回数の制限。写真の配信で持ち主を確かめる（分離テストと `isolation.spec` に要るので R5 から前に出した。docs/decisions/0048）
- lint の L13（`tools/lint-rules/rules/user-scoped-db.ts` とテスト）、マイグレーションの RLS のテスト、API の分離テスト（testing.md §7）、metrics.md §2 の 2 つの指標を `metrics.config.json` に足す
- 性能用データを複数ユーザーにする（metrics.md §1）
- 完了の条件
  - 共通の条件（`metrics:check` が分離テストと RLS の付け忘れを 0 件と判定する）
  - `npm --prefix backend run test:file -- tests/migrations/rls.test.ts tests/api/isolation.test.ts` が通る
  - `node --test tools/lint-rules/tests/user-scoped-db.test.ts` が通る
  - `git grep -n "set_config" -- backend/src ":!backend/src/infra"` が 0 件
  - `git grep -n "from \"pg\"" -- backend/src ":!backend/src/infra"` が 0 件
  - `npm run test:e2e -- isolation.spec` が通る（testing.md §5 の 11）

### R3. 復旧コードとすべてのデータを消す（docs/decisions/0033・0039）
- `GET /api/account`・`POST /api/account/recovery-code`・`POST /api/account/restore`・`DELETE /api/account`（api.md §6）、復旧コードの入力の回数の制限、認証の関数の `auth_restore`（data.md §4）
- 設定のシート、復旧コードの表示・入力、控えるよう勧めるカード、すべてのデータを消す（screens.md §9）
- 完了の条件
  - 共通の条件
  - `npm --prefix backend run test:file -- tests/api/account.test.ts` が通る（testing.md §2 のアカウント・復旧コード・回数の制限・すべて消す）
  - `npm run test:e2e -- account.spec` が通る（testing.md §5 の 12・13）
  - 分離テストのケースの表に `/api/account` の 4 つのルートがある（`npm --prefix backend run test:file -- tests/api/isolation.test.ts` が通る）

### R4. API のセキュリティの土台（docs/decisions/0038・0042）
- Origin の確認、JSON の `Content-Type` の確認、書き込みの回数の制限、`/api/metrics` のトークン、`/api/health/db` の `message` を隠す、500 の `message`、API の `Cache-Control: no-store`
- JSON のログ（`kind`）。Cookie・復旧コード・タイトルをログに出さない
- Dependabot（`.github/dependabot.yml`、週 1 回）
- 完了の条件
  - 共通の条件
  - `npm --prefix backend run test:file -- tests/api/security.test.ts` が通る（testing.md §2 のセキュリティ）
  - `test -f .github/dependabot.yml`
  - `npm --prefix backend run test:file -- tests/unit/json-logger.test.ts` が通り、その中で Cookie・復旧コードを渡しても出力に含まれないことを確かめる

### R5. 写真を Cloud Storage へ（docs/decisions/0037）
- `GcsPhotoFiles`（`PHOTO_BUCKET` があれば使う）、`GcsPhotoFiles` での配信（持ち主の確かめと `private`・`Vary: Cookie` は R2 で入れた）、配信のそのほかのヘッダー（CSP・`Content-Disposition`）、sharp で作り直す、1 人あたりの上限と保存の回数の制限、`achievements.photo_bytes`
- CI で fake-gcs-server を起動し（サービスコンテナは起動の引数を渡せないので `docker run`。docs/decisions/0051）、`GcsPhotoFiles` を `LocalPhotoFiles` と同じテストで確かめる
- 完了の条件
  - 共通の条件（`metrics:check` で、アップロードの p95 が 300ms 以内。超えたら新しい記録で目標を見直す）
  - `npm --prefix backend run test:file -- tests/api/achievement-photos.test.ts tests/api/photo-files-contract.test.ts` が通る（EXIF が残らない、`private`・`Vary: Cookie`・CSP、上限で 429、他人の写真が 404）

### R6. PWA と、ポリシー・規約のページ（docs/decisions/0032・0039・0045）
- vite-plugin-pwa（JS・CSS・アイコンだけを先にキャッシュし、`index.html` は通信を先に試す）、manifest とアイコン、`/privacy`・`/terms`、追加ダイアログと設定のシートのポリシー・規約へのリンク（screens.md §2・§9・§10。docs/decisions/0049）。noindex は R7 で Express が差し込む（ビルドには入れない）
- 完了の条件
  - 共通の条件（初期表示の JS サイズが 200KB 以内のまま）
  - `npm --prefix frontend run build` のあと、`test -f frontend/dist/manifest.webmanifest && test -f frontend/dist/sw.js`
  - `grep -c noindex frontend/dist/index.html` が 0（ビルドに noindex を入れていない。architecture.md §4.3）
  - `npm run test:e2e -- pwa.spec legal.spec` が通る（testing.md §5 の 14。`/api` がキャッシュされないこと、`index.html` を通信できるときは取り直すことを含む）

### R7. 本番用のコンテナ（docs/decisions/0035）
- `Dockerfile`（frontend をビルドし、backend が `frontend/dist` を配る）。画面のセキュリティのヘッダーと CSP、キャッシュのヘッダー、`PUBLIC_INDEXING` による `X-Robots-Tag` と `index.html` への noindex の meta の差し込み、`APP_ENV` による切り替え（PortGuard を使わない、`trust proxy`、`Secure`）（architecture.md §4.3）
- E2E を、Express が画面も配る形に変える（testing.md §5）
- CI に、イメージを作ってスモークテストするジョブを足す（testing.md §6 の 8）
- 完了の条件
  - 共通の条件（E2E が CSP の効いた状態で通る）
  - `docker build -t optionlist:local .` が通る（CI の中で）
  - `npm run smoke:image -- optionlist:local` が通る（`/api/health` が 200、`/` に CSP と `X-Robots-Tag: noindex` が付き、本文に noindex の meta が入る、`PUBLIC_INDEXING=true` で起動し直すとヘッダーも meta も消える、`/api/metrics` がトークンなしで 404、`/suggestions/1` が `index.html` を返す）

### R8. 確認用・本番の環境と自動デプロイ（docs/decisions/0035・0036）
- `infra/` の gcloud のスクリプト（Cloud SQL の共用インスタンス、DB とロール、入れ物、サービスアカウント、Secret Manager、Artifact Registry、Cloud Run のサービスとマイグレーションの Job、ドメインマッピング、Workload Identity Federation）
- `npm run infra:check -- <env>`（architecture.md §4.1 の設定を gcloud で読んで確かめる）
- `.github/workflows/deploy.yml`（main で確認用へ、Environment `production` の承認で本番へ。同じイメージ）
- アクセスのログ（Cloud Logging の `_Default` などのバケット）の保存場所を決める。国内（asia-northeast1）に置けなければ、プライバシーポリシーの「預け先」を直す（docs/decisions/0052）
- 実際の請求の見込みを確かめ、docs/decisions/ に新しい記録を書く（docs/decisions/0035）。ドメインマッピングが asia-northeast1 で使えなければ、代わりの方法を新しい記録で決める（SPEC.md §3）
- 完了の条件
  - 共通の条件
  - `npm run infra:check -- instance`・`npm run infra:check -- staging`・`npm run infra:check -- production` が終了コード 0（`instance` は共用の Cloud SQL のインスタンスの設定、環境はその環境のサービス・DB・入れ物の設定。各環境の DB で、testing.md §7 の 2 のロールとポリシーの確かめ〈BYPASSRLS がない、`ol_app`・`PUBLIC` 宛てのポリシーが各表 1 本で決まった式だけ、`ol_app` がほかの `ol_*` のメンバーでない、`USING (true)` が許可したロールにしかない〉と同じ SQL を流す。マイグレーションのテストと同じ SQL のファイル〈`backend/db/checks/rls-checks.sql`〉を使う）
  - `curl -fsS https://<確認用のドメイン>/api/health` と `curl -fsS https://<本番のドメイン>/api/health` が `{"status":"ok"}`
  - `curl -sI https://<本番のドメイン>/ | grep -i "content-security-policy"` が 1 行出る
  - `git grep -n -E "private_key|BEGIN (RSA )?PRIVATE KEY" -- . ":!docs"` が 0 件（鍵をリポジトリに置いていない。この行のような文書は除く）
  - 確認用で、手で 1 件追加して写真を付け、別のブラウザから見えないことを確かめる（PR 本文に書く）

### R9. 削除のジョブ（docs/decisions/0040）
- `backend/src/jobs/cleanup.ts`（data.md §5 の 5 種類）、`ol_cleanup` での接続、Cloud Run Job と Cloud Scheduler（毎日 4 時）、消した件数のログ
- 設定のシートに「5 年間使わないと、データは消えます」（screens.md §9）
- 完了の条件
  - 共通の条件
  - `npm --prefix backend run test:file -- tests/api/cleanup-job.test.ts` が通る（時計をフェイクで進め、5 年・30 日・90 日・7 日・行のない写真の 1 日の境目の前後を確かめる。期限前の人の行が残る）
  - `gcloud run jobs execute optionlist-staging-cleanup --region asia-northeast1 --wait` が成功する
  - `npm run infra:check -- production` が Scheduler のジョブ（ENABLED、毎日 4 時）も確かめて終了コード 0

### R10. バックアップ・監視・利用状況（docs/decisions/0041・0042・0043）
- 週 1 の書き出しの Job（`ol_migrator` で `pg_dump --enable-row-security`、`optionlist_production` だけ）と入れ物、写真の soft delete、`npm run ops:restore-drill -- <staging|production>`（新しい一時的なインスタンスに戻して `optionlist_<env>` の利用者の表を数える。data.md §6）
- アラート（死活監視、5xx、`unhandled_error`・`orphan_file_error`、`client_error` の件数、ジョブの失敗と止まり、予算）とメールの通知先（metrics.md §8）
- 集計のビュー（`usage_*`）と `ol_metrics`、`npm run metrics:usage` を 1 人あたりの指標に（metrics.md §6）
- 完了の条件
  - 共通の条件
  - `npm run infra:check -- instance` が、自動バックアップ・時点復旧・インスタンスを消してもバックアップを残す設定・削除保護を確かめ、`npm run infra:check -- production` が、写真の soft delete・書き出しの Job と Scheduler・アラートのポリシーと死活監視・予算のアラートと、`rls-checks.sql`（`ol_incident` が SELECT だけ、強いロールのメンバーになっているログインできるロールが 0 件、を含む。testing.md §7）を確かめて、どちらも終了コード 0
  - 確認用で自分のデータ（項目・達成・写真）を作ったうえで、`npm run ops:restore-drill -- staging` が終了コード 0 で、`docs/ops/restore-drills.md` の表に `| optionlist_staging |` で結果が `成功` の行（data.md §6 の 3・5 の条件: バックアップの前後に残っていた ID がすべて戻り、空ではなく、前後で写真が変わっていない達成で「行があるのに写真がない」が 0 件）が 1 行増える（`grep -c "| optionlist_staging |.*| 成功 |" docs/ops/restore-drills.md` が 1 以上）。本番は、まだ利用者の行がないので、ここでは訓練しない（R11 の 1 段目で行う。data.md §6）
  - 訓練のあと `gcloud sql instances list --filter="name:restore-drill-*" --format="value(name)"` が何も出さない（一時的なインスタンス〈`restore-drill-<日時>`。data.md §6〉を消した）
  - `npm --prefix backend run test:file -- tests/migrations/rls.test.ts` が、`ol_metrics` がビュー以外を読めないことも確かめて通る
  - `METRICS_DATABASE_URL=<確認用の接続先> npm run metrics:usage` が、metrics.md §6 のすべての指標を出す
  - 確認用で、わざと `/api/health` を失敗させてアラートのメールが届くことを確かめる（PR 本文に書く）

### R11. 公開（docs/decisions/0045）
- `docs/ops/launch-checklist.md` に、自分だけの 2 週間・知人数人・一般公開のそれぞれの確認の項目を `- [ ]` で書き、終わったものを `- [x]` にする
- 1 段目（自分だけの 2 週間）の間に、本番で最初の復旧の訓練（`npm run ops:restore-drill -- production`）を行う（data.md §6）
- 実機での結果（iPhone のホーム画面に追加したときに同じアカウントか）を書き、違ったら screens.md §9 と docs/decisions/ を直す
- プライバシーポリシー・利用規約の文面を確定し、`PUBLIC_INDEXING=true` にして `noindex` を外す
- 完了の条件
  - 共通の条件
  - `grep -c -F -- "- [ ]" docs/ops/launch-checklist.md` が 0（終わっていない項目がない）
  - `docs/ops/restore-drills.md` の表に、本番の訓練の成功の行が 1 行以上ある（`grep -c "| optionlist_production |.*| 成功 |" docs/ops/restore-drills.md` が 1 以上。R10 の行は `optionlist_staging` なので数えられない）
  - `curl -sI https://<本番のドメイン>/ | grep -ci "x-robots-tag"` が 0、`curl -s https://<本番のドメイン>/ | grep -c noindex` が 0
  - `npm run infra:check -- production` が終了コード 0
  - `git grep -n "example.invalid" -- frontend/src` が 0 件（ポリシーの仮の問い合わせ先を、専用のアドレスに差し替えた。docs/decisions/0052）
